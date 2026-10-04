import { getDatabase } from '../../database';
import { requireAuth } from '../../utils/auth';
import { setAppSetting, deleteAppSetting } from '../../utils/app-settings';
import { resolveLocaleSettings } from '../../utils/locale-settings';
import { rescheduleReportSchedules } from '#shared/handlers/reports';
import { scheduleTimeZone } from '#shared/reports/schedule';
import { LOCALE_SETTING_KEY, TIME_ZONE_SETTING_KEY, coerceLocale, coerceTimeZone } from '#shared/i18n/locale-format';

defineRouteMeta({
  openAPI: {
    tags: ['Settings'],
    summary: 'Save date & time localization settings',
    description:
      'Sets the instance-default locale and/or time zone for formatting dates and times. A field accepts a BCP-47 locale / IANA time zone, the keyword "auto" (follow the browser), or null to reset it to the built-in default. A field pinned by PIWI_LOCALE / PIWI_TIME_ZONE is env-managed and any write to it is refused with HTTP 409. Requires administrator role.',
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const db = await getDatabase();

  const current = await resolveLocaleSettings(db);
  const body = (await readBody(event)) as { locale?: string | null; timeZone?: string | null };

  if (body.locale !== undefined) {
    if (current.localeEnvManaged) {
      throw apiError({ statusCode: 409, message: 'The locale is managed by the PIWI_LOCALE environment variable' });
    }
    if (body.locale === null) {
      await deleteAppSetting(db, LOCALE_SETTING_KEY);
    } else {
      const locale = coerceLocale(body.locale);
      if (!locale) throw apiError({ statusCode: 400, message: `Invalid locale: ${body.locale}` });
      await setAppSetting(db, LOCALE_SETTING_KEY, { value: locale });
    }
  }

  if (body.timeZone !== undefined) {
    if (current.timeZoneEnvManaged) {
      throw apiError({
        statusCode: 409,
        message: 'The time zone is managed by the PIWI_TIME_ZONE environment variable',
      });
    }
    if (body.timeZone === null) {
      await deleteAppSetting(db, TIME_ZONE_SETTING_KEY);
    } else {
      const timeZone = coerceTimeZone(body.timeZone);
      if (!timeZone) throw apiError({ statusCode: 400, message: `Invalid time zone: ${body.timeZone}` });
      await setAppSetting(db, TIME_ZONE_SETTING_KEY, { value: timeZone });
    }
  }

  const resolved = await resolveLocaleSettings(db);
  // Report schedules fire in the instance time zone: move their next firings onto the new one.
  if (body.timeZone !== undefined && resolved.timeZone !== current.timeZone) {
    await rescheduleReportSchedules(db as any, scheduleTimeZone(resolved.timeZone));
  }
  return resolved;
});
