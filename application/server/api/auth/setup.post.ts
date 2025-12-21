import { createUser, isAuthEnabled } from '../../utils/auth'
import { getDatabase } from '../../database'
import { users } from '../../database/schema'
import { z } from 'zod'

const createAdminSchema = z.object({
  username: z.string().min(3),
  password: z.string().min(6),
  name: z.string().optional()
})

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    throw createError({
      statusCode: 400,
      message: 'Authentication is not enabled'
    })
  }

  const db = getDatabase()

  // Check if any users exist
  const existingUsers = await db.select().from(users)
  if (existingUsers.length > 0) {
    throw createError({
      statusCode: 400,
      message: 'Users already exist. This endpoint is only for initial setup.'
    })
  }

  const body = await readBody(event)
  const validation = createAdminSchema.safeParse(body)

  if (!validation.success) {
    throw createError({
      statusCode: 400,
      message: 'Invalid request body',
      data: validation.error.issues
    })
  }

  const { username, password, name } = validation.data

  // Create admin user
  const user = await createUser(username, password, 'administrator', name)

  return {
    success: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name
    }
  }
})
