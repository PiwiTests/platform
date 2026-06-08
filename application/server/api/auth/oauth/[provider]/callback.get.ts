import { isAuthEnabled } from '../../../../utils/auth'
import { handleOAuthCallback } from '../../../../utils/oauth'

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    return sendRedirect(event, '/login?error=auth-disabled')
  }

  const provider = getRouterParam(event, 'provider')
  if (!provider) {
    return sendRedirect(event, '/login?error=invalid-provider')
  }

  const redirectUrl = await handleOAuthCallback(event, provider)
  return sendRedirect(event, redirectUrl)
})
