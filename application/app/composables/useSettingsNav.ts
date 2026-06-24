export function useSettingsNav() {
  return [
    { label: 'Account', icon: 'i-lucide-user-round', to: '/settings/account' },
    { label: 'Users', icon: 'i-lucide-users', to: '/settings/users' },
    { label: 'Notifications', icon: 'i-lucide-bell', to: '/settings/notifications' },
    { label: 'Tags', icon: 'i-lucide-tags', to: '/settings/tags' },
    { label: 'Storage', icon: 'i-lucide-hard-drive', to: '/settings/storage' },
    { label: 'Wasted time', icon: 'i-lucide-hourglass', to: '/settings/wasted-time' },
    { label: 'AI diagnosis', icon: 'i-lucide-sparkles', to: '/settings/ai' },
  ] as const;
}
