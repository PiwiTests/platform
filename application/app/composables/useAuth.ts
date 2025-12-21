export interface AuthUser {
  id: number
  username: string
  role: string
  name?: string | null
}

export interface AuthState {
  authenticated: boolean
  user: AuthUser | null
}

export const useAuth = () => {
  const authState = useState<AuthState>('auth', () => ({
    authenticated: false,
    user: null
  }))

  const fetchUser = async () => {
    try {
      const data = await $fetch<AuthState>('/api/auth/me')
      authState.value = data
      return data
    } catch {
      authState.value = { authenticated: false, user: null }
      return { authenticated: false, user: null }
    }
  }

  const login = async (username: string, password: string) => {
    const data = await $fetch<{ success: boolean, user: AuthUser }>('/api/auth/login', {
      method: 'POST',
      body: { username, password }
    })

    if (data.success && data.user) {
      authState.value = {
        authenticated: true,
        user: data.user
      }
    }

    return data
  }

  const logout = async () => {
    await $fetch('/api/auth/logout', {
      method: 'POST'
    })

    authState.value = {
      authenticated: false,
      user: null
    }

    await navigateTo('/login')
  }

  const hasRole = (roles: string[]) => {
    if (!authState.value.user) {
      return false
    }
    return roles.includes(authState.value.user.role)
  }

  const isAdmin = computed(() => hasRole(['administrator']))
  const isReporter = computed(() => hasRole(['reporter']))
  const canEdit = computed(() => hasRole(['administrator']))

  return {
    authState,
    fetchUser,
    login,
    logout,
    hasRole,
    isAdmin,
    isReporter,
    canEdit
  }
}
