import { getDatabase } from '../../database'
import { users } from '../../database/schema'
import { isAuthEnabled } from '../../utils/auth'

export default eventHandler(async (event) => {
  const db = getDatabase()

  // Get all users (exclude password field)
  const allUsers = await db.select({
    id: users.id,
    username: users.username,
    role: users.role,
    name: users.name,
    createdAt: users.createdAt,
    updatedAt: users.updatedAt
  }).from(users)

  return {
    users: allUsers,
    authEnabled: isAuthEnabled(event)
  }
})
