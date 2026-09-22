import { getAppSetting } from './app-settings';
import {
  AUTO,
  BUILTIN_LOCALE,
  LOCALE_SETTING_KEY,
  TIME_ZONE_SETTING_KEY,
  resolveInstanceLocale,
  resolveInstanceTimeZone,
  type LocalePref,
  type TimeZonePref,
} from '#shared/i18n/locale-format';
import type { DbClient } from '../database';

export interface ResolvedLocaleSettings {
  /** Effective instance-default locale (`'auto'` or a BCP-47 tag). */
  locale: LocalePref;
  /** Effective instance-default time zone (`'auto'` or an IANA zone). */
  timeZone: TimeZonePref;
  /** True when `PIWI_LOCALE` pins the locale (the UI shows it read-only). */
  localeEnvManaged: boolean;
  /** True when `PIWI_TIME_ZONE` pins the time zone. */
  timeZoneEnvManaged: boolean;
  /** Built-in defaults, so the settings page can label the fallback. */
  defaults: { locale: LocalePref; timeZone: TimeZonePref };
}

/**
 * Resolve the instance-default date/time formatting settings. Precedence per
 * field: the `PIWI_LOCALE` / `PIWI_TIME_ZONE` env var (locks the UI), then the
 * stored app setting, then the built-in default (`en-US`, browser zone). This is
 * the instance default only — the per-viewer override lives in the browser and
 * is layered on top client-side.
 */
export async function resolveLocaleSettings(db: DbClient): Promise<ResolvedLocaleSettings> {
  const config = useRuntimeConfig();
  const envLocale = config.public?.dateLocale as string | undefined;
  const envTimeZone = config.public?.dateTimeZone as string | undefined;

  const storedLocale = (await getAppSetting<{ value: string }>(db, LOCALE_SETTING_KEY))?.value;
  const storedTimeZone = (await getAppSetting<{ value: string }>(db, TIME_ZONE_SETTING_KEY))?.value;

  const { locale, envManaged: localeEnvManaged } = resolveInstanceLocale(envLocale, storedLocale);
  const { timeZone, envManaged: timeZoneEnvManaged } = resolveInstanceTimeZone(envTimeZone, storedTimeZone);

  return {
    locale,
    timeZone,
    localeEnvManaged,
    timeZoneEnvManaged,
    defaults: { locale: BUILTIN_LOCALE, timeZone: AUTO },
  };
}
