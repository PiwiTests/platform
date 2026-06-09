import { isAuthEnabled } from '../../../../utils/auth'
import { initiateOAuth } from '../../../../utils/oauth'

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    throw createError({
      statusCode: 400,
      message: 'Authentication is not enabled'
    })
  }

  const provider = getRouterParam(event, 'provider')
  if (!provider) {
    throw createError({
      statusCode: 400,
      message: 'Provider is required'
    })
  }

  const redirectUrl = initiateOAuth(event, provider)
  if (!redirectUrl) {
    throw createError({
      statusCode: 400,
      message: `OAuth provider "${provider}" is not configured`
    })
  }

  return sendRedirect(event, redirectUrl)
})
