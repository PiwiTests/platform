import { getDatabase } from '../../../../database'
import { apiKeys } from '../../../../database/schema'
import { eq, and } from 'drizzle-orm'
import { requireAuth } from '../../../../utils/auth'

defineRouteMeta({
  openAPI: {
    tags: ['Users'],
    summary: 'Delete an API key',
    description: 'Revokes an API key by ID. Non-administrators can only revoke their own keys.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'keyId', in: 'path', required: true, schema: { type: 'integer' } }
    ]
  }
})

export default eventHandler(async (event) => {
  const currentUser = await requireAuth(event, ['administrator', 'reporter', 'user'])

  const targetId = parseInt(getRouterParam(event, 'id') || '0')
  const keyId = parseInt(getRouterParam(event, 'keyId') || '0')

  if (!targetId || !keyId) {
    throw createError({ statusCode: 400, message: 'Invalid user ID or key ID' })
  }

  // Non-administrators can only revoke their own keys
  if (currentUser.role !== 'administrator' && currentUser.id !== targetId) {
    throw createError({ statusCode: 403, message: 'Insufficient permissions' })
  }

  const db = await getDatabase()

  // Verify the key exists and belongs to the target user
  const keyResults = await db.select().from(apiKeys).where(
    and(eq(apiKeys.id, keyId), eq(apiKeys.userId, targetId))
  )
  if (!keyResults[0]) {
    throw createError({ statusCode: 404, message: 'API key not found' })
  }

  await db.delete(apiKeys).where(eq(apiKeys.id, keyId))

  return { success: true }
})
