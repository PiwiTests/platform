export function useSettingsNav() {
  return [
    { label: 'Users', icon: 'i-lucide-users', to: '/settings/users' },
    { label: 'Tags', icon: 'i-lucide-tags', to: '/settings/tags' },
    { label: 'Storage', icon: 'i-lucide-hard-drive', to: '/settings/storage' },
    { label: 'AI diagnosis', icon: 'i-lucide-sparkles', to: '/settings/ai' }
  ] as const
}
