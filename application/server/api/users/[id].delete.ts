import { getDatabase } from '../../database'
import { users } from '../../database/schema'
import { eq } from 'drizzle-orm'
import { requireAuth, isAuthEnabled } from '../../utils/auth'

export default eventHandler(async (event) => {
  // If auth is enabled, require administrator role
  const currentUser = await requireAuth(event, ['administrator'])

  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid user ID'
    })
  }

  const db = await getDatabase()

  // Check if user exists
  const userResults = await db.select().from(users).where(eq(users.id, id))
  const targetUser = userResults[0]
  if (!targetUser) {
    throw createError({
      statusCode: 404,
      message: 'User not found'
    })
  }

  // Guard against lockout (only meaningful when authentication is enabled)
  if (isAuthEnabled(event)) {
    if (currentUser.id === id) {
      throw createError({
        statusCode: 400,
        message: 'You cannot delete your own account'
      })
    }
    if (targetUser.role === 'administrator') {
      const admins = await db.select({ id: users.id }).from(users).where(eq(users.role, 'administrator'))
      if (admins.length <= 1) {
        throw createError({
          statusCode: 400,
          message: 'Cannot delete the last administrator'
        })
      }
    }
  }

  // Delete user
  await db.delete(users).where(eq(users.id, id))

  return {
    success: true
  }
})
