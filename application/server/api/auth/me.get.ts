import { getCurrentUser, isAuthEnabled } from '../../utils/auth'

export default eventHandler(async (event) => {
  if (!isAuthEnabled(event)) {
    return {
      authenticated: false,
      user: null
    }
  }

  const user = await getCurrentUser(event)

  if (!user) {
    return {
      authenticated: false,
      user: null
    }
  }

  return {
    authenticated: true,
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      name: user.name,
      avatarUrl: user.avatarUrl
    }
  }
})
