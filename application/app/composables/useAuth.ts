import type { AuthUser, AuthState } from '~~/types/api';
import { Role } from '#shared/types';
import { DEMO_USERS, DEFAULT_DEMO_USER_ID, DEMO_USER_STORAGE_KEY, findDemoUser } from '~/demo/demo-users';

export { type AuthUser, type AuthState };

/** Build the auth state for a demo identity id (used by the "act as" switcher). */
function demoStateFor(id: number): AuthState {
  const u = findDemoUser(id);
  return {
    authenticated: true,
    user: { id: u.id, username: u.username, role: u.role, name: u.name },
  };
}

function readSelectedDemoUserId(): number {
  if (!import.meta.client) return DEFAULT_DEMO_USER_ID;
  const stored = Number(localStorage.getItem(DEMO_USER_STORAGE_KEY));
  return DEMO_USERS.some((u) => u.id === stored) ? stored : DEFAULT_DEMO_USER_ID;
}

export const useAuth = () => {
  const config = useRuntimeConfig();

  const authState = useState<AuthState>('auth', () => {
    if (config.public.demoMode) {
      return demoStateFor(readSelectedDemoUserId());
    }
    return { authenticated: false, user: null };
  });

  // Demo: the list of identities the "act as" switcher can pick from, and the
  // currently selected one.
  const demoUsers = DEMO_USERS;
  const currentDemoUserId = computed(() => authState.value.user?.id ?? DEFAULT_DEMO_USER_ID);

  /**
   * Switch the active demo identity.  Persists the choice and reloads so every
   * `useFetch`/SW-scoped request re-runs under the new identity (project
   * affectations are applied server-side in the demo service worker).
   */
  const setDemoUser = (id: number) => {
    if (!config.public.demoMode || !import.meta.client) return;
    localStorage.setItem(DEMO_USER_STORAGE_KEY, String(id));
    authState.value = demoStateFor(id);
    window.location.reload();
  };

  /**
   * Whether the active demo identity has access to a project (its affectations).
   * Mirrors the server's project-scope rules: admins and globally-assigned users
   * see everything; others only their assigned projects. Always true outside the
   * demo (real access control is enforced server-side there).
   */
  const canAccessDemoProject = (projectId: number): boolean => {
    if (!config.public.demoMode) return true;
    const u = findDemoUser(currentDemoUserId.value);
    if (u.role === Role.ADMINISTRATOR || u.assignment.global) return true;
    return u.assignment.projectIds.includes(projectId);
  };

  const fetchUser = async (): Promise<AuthState> => {
    if (config.public.demoMode) {
      const state = demoStateFor(readSelectedDemoUserId());
      authState.value = state;
      return state;
    }
    try {
      // During SSR, $fetch doesn't forward the browser's cookie header automatically.
      // useRequestHeaders forwards it so the session can be read server-side.
      const headers = import.meta.server ? useRequestHeaders(['cookie']) : {};
      const data = await $fetch<AuthState>('/api/auth/me', { headers });
      authState.value = data;
      return data;
    } catch {
      authState.value = { authenticated: false, user: null };
      return { authenticated: false, user: null };
    }
  };

  const login = async (username: string, password: string) => {
    const data = await $fetch<{ success: boolean; user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: { username, password },
    });

    if (data.success && data.user) {
      authState.value = {
        authenticated: true,
        user: data.user,
      };
    }

    return data;
  };

  const logout = async () => {
    await $fetch('/api/auth/logout', {
      method: 'POST',
    });

    authState.value = {
      authenticated: false,
      user: null,
    };

    await navigateTo('/login');
  };

  const hasRole = (roles: Role[]) => {
    if (!authState.value.user) {
      return false;
    }
    return roles.includes(authState.value.user.role);
  };

  const isAdmin = computed(() => hasRole([Role.ADMINISTRATOR]));
  const isReporter = computed(() => hasRole([Role.REPORTER]));
  const canEdit = computed(() => hasRole([Role.ADMINISTRATOR]));

  return {
    authState,
    fetchUser,
    login,
    logout,
    hasRole,
    isAdmin,
    isReporter,
    canEdit,
    // Demo "act as" switcher
    demoUsers,
    currentDemoUserId,
    setDemoUser,
    canAccessDemoProject,
  };
};
