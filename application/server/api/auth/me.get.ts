import { Role } from '../../../shared/types';
import { getCurrentUser, isAuthEnabled } from '../../utils/auth';

const REQUIRED_ROLES: Role[] = [];

defineRouteMeta({
  openAPI: {
    tags: ['Auth'],
    summary: 'Get current user',
    description: 'Returns the currently authenticated user details or unauthenticated status.',
    'x-required-roles': REQUIRED_ROLES,
    security: [],
  },
});

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    return {
      authenticated: false,
      user: null,
    };
  }

  const user = await getCurrentUser(event);

  if (!user) {
    return {
      authenticated: false,
      user: null,
    };
  }

  return {
    authenticated: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role as Role,
      name: user.name,
      avatarUrl: user.avatarUrl,
      email: user.email,
      emailVerified: user.emailVerified,
      oauthProvider: user.oauthProvider,
      hasPassword: Boolean(user.password),
    },
  };
});
