import type { NavigationMenuItem } from '@nuxt/ui';
import { toValue, type MaybeRefOrGetter } from 'vue';
import { buildSettingsNavSections, type SettingsPageId } from '~/utils/settings-metadata';
import { CAPABILITIES, type CapabilityId } from '#shared/capabilities';

/**
 * Reactive wrapper around `buildSettingsNavSections`.
 *
 * Resolves who the viewer is (admin or not, desktop build or not) from the Nuxt
 * composables and hands that to the pure builder, which owns the actual
 * filtering and grouping. Returns the `[][]` shape `UNavigationMenu` renders
 * with a separator between sections; callers wanting one flat list (the user
 * menu) call `.flat()`.
 *
 * `envManaged` is the per-page state from `useSettingsEnvState` (a ref or
 * getter); pass it to make the lock badges reactive. When omitted, no lock
 * badges are shown.
 */
export async function useSettingsNav(envManaged?: MaybeRefOrGetter<Record<SettingsPageId, boolean>>) {
  const { canSeeAdmin } = useAuth();
  const isDesktop = useIsDesktop();
  const { isHidden } = await useInstanceCapabilities();

  const declinedCapabilities = computed(() => {
    const set = new Set<CapabilityId>();
    for (const cap of CAPABILITIES) if (isHidden(cap.id)) set.add(cap.id);
    return set;
  });

  return computed<NavigationMenuItem[][]>(() =>
    buildSettingsNavSections({
      canSeeAdmin: canSeeAdmin.value,
      isDesktop,
      envManaged: envManaged ? toValue(envManaged) : undefined,
      declinedCapabilities: declinedCapabilities.value,
    }),
  );
}
