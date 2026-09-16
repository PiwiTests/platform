import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { getAutoHealSettings } from '../../utils/heal/settings';
import { DEFAULT_AUTO_HEAL } from '#shared/auto-heal';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get auto-heal settings',
    description:
      'The current auto-heal configuration — whether Piwi opens fix pull requests for broken locators, and on which projects. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();
  return {
    settings: await getAutoHealSettings(db),
    defaults: DEFAULT_AUTO_HEAL,
    siteUrlConfigured: Boolean(process.env.PIWI_SITE_URL?.trim()),
  };
});
