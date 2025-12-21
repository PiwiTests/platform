import { getDatabase } from '../../database'
import { users } from '../../database/schema'
import { eq } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'

export default eventHandler(async (event) => {
  // If auth is enabled, require administrator role
  await requireAuth(event, ['administrator'])

  const id = parseInt(getRouterParam(event, 'id') || '0')

  if (!id) {
    throw createError({
      statusCode: 400,
      message: 'Invalid user ID'
    })
  }

  const db = getDatabase()

  // Check if user exists
  const userResults = await db.select().from(users).where(eq(users.id, id))
  if (!userResults[0]) {
    throw createError({
      statusCode: 404,
      message: 'User not found'
    })
  }

  // Delete user
  await db.delete(users).where(eq(users.id, id))

  return {
    success: true
  }
})
