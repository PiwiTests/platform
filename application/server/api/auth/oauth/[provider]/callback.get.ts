import { Role } from '../../../../../shared/types';
import { isAuthEnabled } from '../../../../utils/auth';
import { handleOAuthCallback } from '../../../../utils/oauth';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'OAuth callback',
    description:
      'Handles the OAuth provider callback, exchanges the authorization code, creates or links the user, and sets the session.',
    parameters: [{ name: 'provider', in: 'path', required: true, schema: { type: 'string' } }],
    'x-required-roles': REQUIRED_ROLES,
    security: [],
  },
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    return sendRedirect(event, '/login?error=auth-disabled');
  }

  const provider = getRouterParam(event, 'provider');
  if (!provider) {
    return sendRedirect(event, '/login?error=invalid-provider');
  }

  const redirectUrl = await handleOAuthCallback(event, provider);
  return sendRedirect(event, redirectUrl);
});
