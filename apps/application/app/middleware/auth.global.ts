import { Role } from '#shared/types';

// Pages that must work without a session: signing in, and the account-recovery
// pages reached from emailed links.
const PUBLIC_PATHS = ['/login', '/forgot-password', '/reset-password'];

export default defineNuxtRouteMiddleware(async (to) => {
  if (PUBLIC_PATHS.includes(to.path)) {
    return;
  }

  const { authState, fetchUser } = useAuth();
  const config = useRuntimeConfig();

  // Skip auth check in demo mode
  if (config.public.demoMode) {
    return;
  }

  // Check if auth is enabled
  if (!config.public.authEnabled) {
    return;
  }

  // Fetch user if not already loaded
  if (!authState.value.authenticated) {
    const result = await fetchUser();

    if (!result.authenticated) {
      return navigateTo('/login');
    }
  }

  const isAdmin = authState.value.user?.role === Role.ADMINISTRATOR;

  // Check if user is trying to access edit pages
  if (to.path.includes('/edit') && !isAdmin) {
    return navigateTo('/');
  }

  // Setup configures how results reach this instance and, in the desktop build,
  // exposes the local access token — admin-only. The sidebar hides the link, and
  // this stops a non-admin reaching it by typing the URL. The endpoint behind it
  // (`/api/setup-status`) enforces the same role server-side; this is only the
  // affordance. Note the early returns above: with auth disabled every visitor is
  // a virtual admin, which is what keeps Setup reachable on a default install.
  if (to.path === '/setup' && !isAdmin) {
    return navigateTo('/');
  }
});
