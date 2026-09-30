const STORAGE_KEY = 'piwi-diagnosis-notifications';

export function useDiagnosisNotification() {
  const permission = ref<NotificationPermission>('default');

  const enabled = ref(true);

  if (import.meta.client) {
    if ('Notification' in window) {
      permission.value = Notification.permission;
    }
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === 'false') enabled.value = false;
  }

  const supported = computed(() => import.meta.client && 'Notification' in window);

  const active = computed(() => supported.value && permission.value === 'granted' && enabled.value);

  async function requestPermission() {
    if (!supported.value) return;
    const result = await Notification.requestPermission();
    permission.value = result;
  }

  function toggleEnabled() {
    enabled.value = !enabled.value;
    localStorage.setItem(STORAGE_KEY, String(enabled.value));
  }

  return { permission, supported, active, requestPermission, toggleEnabled };
}
