import { createSharedComposable } from '@vueuse/core'

const _useDashboard = () => {
  const router = useRouter()

  defineShortcuts({
    'g-h': () => router.push('/'),
    'g-s': () => router.push('/settings'),
  })


  return {
  }
}

export const useDashboard = createSharedComposable(_useDashboard)
