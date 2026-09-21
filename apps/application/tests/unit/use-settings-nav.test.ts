import { describe, test, expect, vi, afterEach } from 'vitest';
import { computed, ref } from 'vue';
import { useSettingsNav } from '../../app/composables/useSettingsNav';
import type { SettingsPageId } from '../../app/utils/settings-metadata';

/**
 * `useSettingsNav` is a thin reactive wrapper — the filtering and grouping live
 * in `buildSettingsNavSections` (covered in settings-metadata.test.ts). What is
 * only testable here is the wiring: how the viewer's role is derived, and how
 * the `envManaged` ref-or-getter is unwrapped.
 *
 * Nuxt auto-imports are globals at runtime, so they are stubbed rather than
 * imported. `computed` is the real Vue one, so the returned ref behaves.
 */
function stubNuxt(opts: { authEnabled?: boolean; isAdmin?: boolean; desktop?: boolean; declined?: Set<string> } = {}) {
  const authEnabled = opts.authEnabled ?? false;
  const isAdmin = ref(opts.isAdmin ?? false);
  const declined = opts.declined ?? new Set<string>();

  vi.stubGlobal('computed', computed);
  vi.stubGlobal('useRuntimeConfig', () => ({ public: { authEnabled } }));
  vi.stubGlobal('useIsDesktop', () => opts.desktop ?? false);
  // Mirrors the real `useAuth`: with auth disabled there are no users, so nobody
  // holds the administrator role and `canSeeAdmin` has to fall back to true.
  vi.stubGlobal('useAuth', () => ({
    isAdmin,
    canSeeAdmin: computed(() => !authEnabled || isAdmin.value),
  }));
  vi.stubGlobal('useInstanceCapabilities', () => ({ isHidden: (id: string) => declined.has(id) }));
}

const pathsOf = (nav: { value: { to?: string | object }[][] }) => nav.value.flat().map((i) => i.to);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useSettingsNav', () => {
  test('treats every visitor as an admin when auth is disabled', () => {
    // The instance has no users at all, so gating admin pages would lock
    // everyone out of Storage, Tags and AI on a default self-hosted install.
    stubNuxt({ authEnabled: false, isAdmin: false });

    expect(pathsOf(useSettingsNav())).toContain('/settings/storage');
  });

  test('hides admin pages from a non-admin once auth is enabled', () => {
    stubNuxt({ authEnabled: true, isAdmin: false });

    const visible = pathsOf(useSettingsNav());
    expect(visible).not.toContain('/settings/storage');
    expect(visible).toContain('/settings/account');
  });

  test('shows admin pages to an admin when auth is enabled', () => {
    stubNuxt({ authEnabled: true, isAdmin: true });

    expect(pathsOf(useSettingsNav())).toContain('/settings/storage');
  });

  test('hides the auth-only pages in the desktop build', () => {
    stubNuxt({ desktop: true });

    const visible = pathsOf(useSettingsNav());
    expect(visible).not.toContain('/settings/account');
    expect(visible).not.toContain('/settings/users');
    expect(visible).toContain('/settings/storage');
  });

  test('unwraps envManaged given as a ref', () => {
    stubNuxt();
    const managed = ref({ ai: true } as Record<SettingsPageId, boolean>);

    const item = useSettingsNav(managed)
      .value.flat()
      .find((i) => i.to === '/settings/ai');
    expect(item?.badge).toEqual({ icon: 'i-lucide-lock', color: 'neutral' });
  });

  test('unwraps envManaged given as a getter, and tracks its changes', () => {
    stubNuxt();
    const managed = ref({} as Record<SettingsPageId, boolean>);
    const nav = useSettingsNav(() => managed.value);

    const aiItem = () => nav.value.flat().find((i) => i.to === '/settings/ai');
    expect(aiItem()?.badge).toBeUndefined();

    managed.value = { ai: true } as Record<SettingsPageId, boolean>;
    expect(aiItem()?.badge).toEqual({ icon: 'i-lucide-lock', color: 'neutral' });
  });

  test('returns grouped sections, each non-empty', () => {
    stubNuxt();
    const sections = useSettingsNav().value;

    expect(sections.length).toBeGreaterThan(1);
    expect(sections.every((s) => s.length > 0)).toBe(true);
  });

  test('drops a settings page whose capability is declined', () => {
    stubNuxt({ authEnabled: true, isAdmin: true, declined: new Set(['notifications']) });
    const paths = pathsOf(useSettingsNav());

    expect(paths).not.toContain('/settings/notifications');
    expect(paths).toContain('/settings/ai');
  });
});
