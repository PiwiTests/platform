import { clearUserSession, isAuthEnabled } from '../../utils/auth'

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    throw createError({
      statusCode: 400,
      message: 'Authentication is not enabled'
    })
  }

  await clearUserSession(event)

  return {
    success: true
  }
})
