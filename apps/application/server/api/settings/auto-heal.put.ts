import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { setAppSetting, deleteAppSetting } from '../../utils/app-settings';
import { getAutoHealSettings } from '../../utils/heal/settings';
import { AUTO_HEAL_KEY, DEFAULT_AUTO_HEAL, resolveAutoHealSettings, type AutoHealSettings } from '#shared/auto-heal';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Save auto-heal settings',
    description:
      'Configure whether Piwi opens a fix pull request when a locator breaks on the default branch, and on which projects. Off by default, with an explicit per-project allowlist. Send `settings: null` to reset to the built-in defaults. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();

  const body = (await readBody(event)) as { settings?: Partial<AutoHealSettings> | null };

  if (body.settings === null) {
    await deleteAppSetting(db, AUTO_HEAL_KEY);
  } else {
    // Store the fully-resolved object so a partial payload can never leave a
    // half-configured state that writes something unintended to a repository.
    await setAppSetting(db, AUTO_HEAL_KEY, resolveAutoHealSettings(body.settings));
  }

  return {
    settings: await getAutoHealSettings(db),
    defaults: DEFAULT_AUTO_HEAL,
    siteUrlConfigured: Boolean(process.env.PIWI_SITE_URL?.trim()),
  };
});
