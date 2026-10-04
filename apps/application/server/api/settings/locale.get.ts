import { getDatabase } from '../../database';
import { resolveLocaleSettings } from '../../utils/locale-settings';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Get date & time localization settings',
    description:
      'Returns the instance-default locale and time zone used to format dates and times, and whether each is pinned by the PIWI_LOCALE / PIWI_TIME_ZONE environment variable. Public: every viewer needs it to render dates, and it carries nothing sensitive. The per-viewer override lives in the browser and is not part of this response.',
    security: [],
  },
});

export default eventHandler(async () => {
  const db = await getDatabase();
  return resolveLocaleSettings(db);
});
