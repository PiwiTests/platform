import type { NavigationMenuItem } from '@nuxt/ui';
import { toValue, type MaybeRefOrGetter } from 'vue';
import { SETTINGS_PAGES, type SettingsPageId } from '~/utils/settings-metadata';

/**
 * Build the Settings sub-navigation from the shared `SETTINGS_PAGES` registry.
 * Admin-only pages are hidden for non-admins (no more 403 on click). Pages that
 * are currently env-managed get a trailing lock badge, so an admin can see at a
 * glance which settings are pinned by the environment.
 *
 * `envManaged` is the per-page state from `useSettingsEnvState` (a ref or
 * getter); pass it to make the lock badges reactive. When omitted, no lock
 * badges are shown.
 */
export function useSettingsNav(envManaged?: MaybeRefOrGetter<Record<SettingsPageId, boolean>>) {
  const { isAdmin } = useAuth();

  const items = computed<NavigationMenuItem[]>(() => {
    const admin = isAdmin.value;
    const managedMap = envManaged ? toValue(envManaged) : undefined;
    return SETTINGS_PAGES.filter((page) => !page.roles || admin).map((page) => {
      const managed = managedMap?.[page.id] ?? false;
      return {
        label: page.label,
        icon: page.icon,
        to: page.to,
        // Trailing lock badge marks env-pinned pages.
        ...(managed ? { badge: { icon: 'i-lucide-lock', color: 'neutral' as const } } : {}),
      } satisfies NavigationMenuItem;
    });
  });

  return items;
}
