/**
 * Locale-aware date and time formatting, shared by app, server and demo.
 *
 * The dashboard renders every absolute timestamp through `Intl.DateTimeFormat`,
 * so the format (day/month order, 12h vs 24h, separators) follows a BCP-47
 * locale and the displayed moment follows an IANA time zone. Both are resolved
 * in three layers, highest priority first:
 *
 *   1. a per-viewer override kept in the browser (`localStorage`)
 *   2. the instance default: the `PIWI_LOCALE` / `PIWI_TIME_ZONE` env vars
 *      (which lock the admin setting), else the `date_locale` / `date_time_zone`
 *      app settings an administrator saved
 *   3. the built-in default: `en-US` for the locale, the viewer's own browser
 *      zone for the time zone
 *
 * A value is one of:
 *   - `'auto'`   — follow the viewer's browser (its locale, or its time zone)
 *   - a BCP-47 locale tag (`'fr-FR'`) or an IANA zone (`'Europe/Paris'`)
 *
 * The per-viewer override additionally understands `'system'`, meaning "follow
 * the instance default" — the state a viewer who has never chosen is in.
 *
 * This module is pure and depends only on the `Intl` API, so it loads unchanged
 * in the browser, the Nitro server, the demo service worker and unit tests.
 * Relative-time wording ("3 hours ago") is localized separately, in the app,
 * because it uses date-fns rather than `Intl`.
 */

/** A timestamp in any of the shapes the API and the DB hand the UI. */
export type DateInput = string | Date | number | null | undefined;

/** App-settings key holding the instance-default locale. */
export const LOCALE_SETTING_KEY = 'date_locale';
/** App-settings key holding the instance-default time zone. */
export const TIME_ZONE_SETTING_KEY = 'date_time_zone';

/** Locale used when nothing is configured anywhere (the historical behavior). */
export const BUILTIN_LOCALE = 'en-US';

/** Sentinel meaning "follow the viewer's browser". */
export const AUTO = 'auto';
/** Per-viewer sentinel meaning "follow the instance default". */
export const FOLLOW_SYSTEM = 'system';

/**
 * A resolved preference is a concrete choice: `'auto'` (browser) or a specific
 * tag/zone. It never carries the `'system'` sentinel — that is resolved away
 * before a value reaches the formatter.
 */
export type LocalePref = string;
export type TimeZonePref = string;

/** One selectable locale in the settings dropdowns. */
export interface LocaleOption {
  value: string;
  label: string;
}

/**
 * Curated locales offered in the settings dropdown. `Intl` can format any valid
 * BCP-47 tag, so this list is for guidance, not a hard limit — the env var and
 * the free-form validation accept any valid tag. Labels are written in the
 * language they name so a reader recognizes their own.
 */
export const SUPPORTED_LOCALES: readonly LocaleOption[] = [
  { value: AUTO, label: 'Automatic (browser)' },
  { value: 'en-US', label: 'English (United States)' },
  { value: 'en-GB', label: 'English (United Kingdom)' },
  { value: 'fr-FR', label: 'Français (France)' },
  { value: 'fr-CA', label: 'Français (Canada)' },
  { value: 'de-DE', label: 'Deutsch' },
  { value: 'es-ES', label: 'Español (España)' },
  { value: 'es-419', label: 'Español (Latinoamérica)' },
  { value: 'it-IT', label: 'Italiano' },
  { value: 'pt-BR', label: 'Português (Brasil)' },
  { value: 'pt-PT', label: 'Português (Portugal)' },
  { value: 'nl-NL', label: 'Nederlands' },
  { value: 'sv-SE', label: 'Svenska' },
  { value: 'da-DK', label: 'Dansk' },
  { value: 'nb-NO', label: 'Norsk' },
  { value: 'fi-FI', label: 'Suomi' },
  { value: 'pl-PL', label: 'Polski' },
  { value: 'cs-CZ', label: 'Čeština' },
  { value: 'ja-JP', label: '日本語' },
  { value: 'ko-KR', label: '한국어' },
  { value: 'zh-CN', label: '简体中文' },
  { value: 'zh-TW', label: '繁體中文' },
] as const;

/** Fallback zone list when the runtime cannot enumerate IANA zones. */
const FALLBACK_TIME_ZONES: readonly string[] = [
  'UTC',
  'Europe/London',
  'Europe/Paris',
  'Europe/Berlin',
  'Europe/Madrid',
  'Europe/Rome',
  'Europe/Amsterdam',
  'Europe/Moscow',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Shanghai',
  'Asia/Tokyo',
  'Asia/Singapore',
  'Australia/Sydney',
  'Pacific/Auckland',
];

/**
 * Every selectable time zone: `'auto'` first, then the full IANA list the
 * runtime knows (`Intl.supportedValuesOf`), or a curated fallback on runtimes
 * that lack it. The dropdown is searchable, so the long list stays usable.
 */
export function listTimeZoneOptions(): LocaleOption[] {
  let zones: readonly string[] = FALLBACK_TIME_ZONES;
  try {
    const supported = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf;
    if (typeof supported === 'function') {
      const all = supported('timeZone');
      if (Array.isArray(all) && all.length > 0) zones = all;
    }
  } catch {
    // Keep the fallback list.
  }
  return [{ value: AUTO, label: 'Automatic (browser)' }, ...zones.map((z) => ({ value: z, label: z }))];
}

/** True for a BCP-47 tag `Intl` accepts, or the `'auto'` sentinel. */
export function isValidLocale(value: string): boolean {
  if (value === AUTO) return true;
  try {
    // Throws RangeError on a structurally invalid tag; DateTimeFormat alone
    // would silently fall back, so it cannot be the validator.
    Intl.getCanonicalLocales(value);
    return true;
  } catch {
    return false;
  }
}

/** True for an IANA zone `Intl` accepts, or the `'auto'` sentinel. */
export function isValidTimeZone(value: string): boolean {
  if (value === AUTO) return true;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/**
 * Normalize a stored/env locale string to a concrete preference, or `null` when
 * it is empty or invalid (so the caller falls through to the next layer).
 */
export function coerceLocale(value: string | null | undefined): LocalePref | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  return isValidLocale(v) ? v : null;
}

/** Same as {@link coerceLocale} for a time zone. */
export function coerceTimeZone(value: string | null | undefined): TimeZonePref | null {
  const v = (value ?? '').trim();
  if (!v) return null;
  return isValidTimeZone(v) ? v : null;
}

/**
 * The instance-default locale from its two sources: the env value wins and
 * locks the admin UI; otherwise the stored app setting applies; otherwise the
 * built-in `en-US`. Returns the resolved preference and whether the env pinned it.
 */
export function resolveInstanceLocale(env: string | null | undefined, stored: string | null | undefined) {
  const fromEnv = coerceLocale(env);
  if (fromEnv) return { locale: fromEnv, envManaged: true };
  return { locale: coerceLocale(stored) ?? BUILTIN_LOCALE, envManaged: false };
}

/**
 * The instance-default time zone from its two sources. The built-in default is
 * `'auto'` (the viewer's browser zone), which is what the dashboard has always
 * done.
 */
export function resolveInstanceTimeZone(env: string | null | undefined, stored: string | null | undefined) {
  const fromEnv = coerceTimeZone(env);
  if (fromEnv) return { timeZone: fromEnv, envManaged: true };
  return { timeZone: coerceTimeZone(stored) ?? AUTO, envManaged: false };
}

/**
 * Fold a per-viewer override onto an instance default. `'system'` (or any
 * invalid value) defers to the instance default; anything else is the viewer's
 * concrete choice.
 */
export function effectiveLocale(override: string | null | undefined, instanceDefault: LocalePref): LocalePref {
  const v = (override ?? '').trim();
  if (!v || v === FOLLOW_SYSTEM) return instanceDefault;
  return isValidLocale(v) ? v : instanceDefault;
}

/** Same as {@link effectiveLocale} for a time zone. */
export function effectiveTimeZone(override: string | null | undefined, instanceDefault: TimeZonePref): TimeZonePref {
  const v = (override ?? '').trim();
  if (!v || v === FOLLOW_SYSTEM) return instanceDefault;
  return isValidTimeZone(v) ? v : instanceDefault;
}

/** `undefined` for `'auto'` (so `Intl` uses the runtime default), else the tag. */
export function toIntlLocale(pref: LocalePref): string | undefined {
  return pref === AUTO ? undefined : pref;
}

/** `undefined` for `'auto'` (so `Intl` uses the runtime zone), else the zone. */
export function toIntlTimeZone(pref: TimeZonePref): string | undefined {
  return pref === AUTO ? undefined : pref;
}

/** Parse the several timestamp shapes into a `Date`, or `null` when invalid. */
function toDate(date: DateInput): Date | null {
  if (date === null || date === undefined || date === '') return null;

  let d: Date;
  if (date instanceof Date) {
    d = date;
  } else {
    const n = typeof date === 'number' ? date : Number(date);
    if (!Number.isNaN(n) && String(date).trim() !== '') {
      // Numeric input: values below 1e12 are Unix seconds, otherwise milliseconds.
      d = new Date(n < 1e12 ? n * 1000 : n);
    } else {
      // Non-numeric string (ISO 8601, etc.).
      d = new Date(date);
    }
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

export interface FormatPrefs {
  /** Resolved locale preference (`'auto'` or a BCP-47 tag). */
  locale: LocalePref;
  /** Resolved time-zone preference (`'auto'` or an IANA zone). */
  timeZone: TimeZonePref;
  /** Omit the time component (date only). */
  dateOnly?: boolean;
}

/**
 * Format an absolute timestamp for display.
 *
 * With `{ locale: 'en-US', timeZone: 'auto' }` the output is identical to the
 * dashboard's historical `M/d/yyyy, h:mm:ss a` — `Intl` and the previous
 * date-fns format agree byte for byte for that locale. Other locales render in
 * their own convention (`fr-FR` → `22/09/2026 14:30:05`).
 *
 * Returns `'N/A'` for empty or unparseable input. A malformed locale/zone that
 * slipped past validation falls back to `en-US` in the viewer's own zone rather
 * than throwing.
 */
export function formatAbsolute(date: DateInput, prefs: FormatPrefs): string {
  const d = toDate(date);
  if (!d) return 'N/A';

  const options: Intl.DateTimeFormatOptions = prefs.dateOnly
    ? { year: 'numeric', month: 'numeric', day: 'numeric' }
    : { year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: '2-digit', second: '2-digit' };

  const timeZone = toIntlTimeZone(prefs.timeZone);
  if (timeZone) options.timeZone = timeZone;

  try {
    return new Intl.DateTimeFormat(toIntlLocale(prefs.locale), options).format(d);
  } catch {
    const { timeZone: _dropped, ...safe } = options;
    return new Intl.DateTimeFormat(BUILTIN_LOCALE, safe).format(d);
  }
}
