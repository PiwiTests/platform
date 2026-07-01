import { Role } from '#shared/types';

export default defineNuxtRouteMiddleware(async (to) => {
  // Skip auth check for login page
  if (to.path === '/login') {
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

  // Check if user is trying to access edit pages
  if (to.path.includes('/edit') && authState.value.user?.role !== Role.ADMINISTRATOR) {
    return navigateTo('/');
  }
});
