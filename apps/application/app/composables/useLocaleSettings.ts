/**
 * Date & time localization: the three-layer resolution the whole dashboard
 * reads its date format from.
 *
 *   instance default  = PIWI_LOCALE / PIWI_TIME_ZONE env (locks the admin UI)
 *                       ↳ else the stored `date_locale` / `date_time_zone` app
 *                         setting an administrator saved
 *                       ↳ else the built-in default (en-US, browser zone)
 *   per-viewer override = this browser's choice (localStorage), or `'system'`
 *                         to follow the instance default
 *   effective           = override folded onto the instance default
 *
 * The effective locale/zone feed the module-level formatter prefs
 * (`setActiveLocalePrefs`), so every `prettyDateFormat` / `formatRelativeTime`
 * call across the app renders in them. The instance default is shared app-wide
 * through `useState`; the override is per-browser through `useLocalStorage`.
 *
 * Relative-time wording is localized with date-fns locale objects, loaded lazily
 * per locale (English needs none — it is date-fns's default).
 */
import {
  AUTO,
  BUILTIN_LOCALE,
  FOLLOW_SYSTEM,
  SUPPORTED_LOCALES,
  listTimeZoneOptions,
  resolveInstanceLocale,
  resolveInstanceTimeZone,
  effectiveLocale as foldLocale,
  effectiveTimeZone as foldTimeZone,
  formatAbsolute,
  type DateInput,
  type LocalePref,
  type TimeZonePref,
} from '#shared/i18n/locale-format';
import { setActiveLocalePrefs } from '~/utils/locale-format';
import type { Locale } from 'date-fns';

/** localStorage keys for the per-viewer override. */
const USER_LOCALE_KEY = 'piwi-date-locale';
const USER_TIME_ZONE_KEY = 'piwi-date-time-zone';

/** A representative moment for the settings preview (local wall-clock time). */
const SAMPLE_DATE = new Date(2026, 8, 22, 14, 30, 5);

export interface InstanceLocaleState {
  locale: LocalePref;
  timeZone: TimeZonePref;
  localeEnvManaged: boolean;
  timeZoneEnvManaged: boolean;
  defaults: { locale: LocalePref; timeZone: TimeZonePref };
}

/**
 * Lazy date-fns locale loaders, one static specifier each so the bundler emits a
 * separate chunk per locale and only the chosen one is fetched. Keyed by the
 * date-fns subpath code.
 */
const DATE_FNS_LOADERS: Record<string, () => Promise<unknown>> = {
  'en-GB': () => import('date-fns/locale/en-GB'),
  fr: () => import('date-fns/locale/fr'),
  'fr-CA': () => import('date-fns/locale/fr-CA'),
  de: () => import('date-fns/locale/de'),
  es: () => import('date-fns/locale/es'),
  it: () => import('date-fns/locale/it'),
  'pt-BR': () => import('date-fns/locale/pt-BR'),
  pt: () => import('date-fns/locale/pt'),
  nl: () => import('date-fns/locale/nl'),
  sv: () => import('date-fns/locale/sv'),
  da: () => import('date-fns/locale/da'),
  nb: () => import('date-fns/locale/nb'),
  fi: () => import('date-fns/locale/fi'),
  pl: () => import('date-fns/locale/pl'),
  cs: () => import('date-fns/locale/cs'),
  ja: () => import('date-fns/locale/ja'),
  ko: () => import('date-fns/locale/ko'),
  'zh-CN': () => import('date-fns/locale/zh-CN'),
  'zh-TW': () => import('date-fns/locale/zh-TW'),
};

/**
 * The date-fns locale for a resolved locale preference, or `undefined` for
 * English (date-fns's default) and for locales without a matching module. Tries
 * the full tag, then the language subtag (`fr-FR` → `fr`).
 */
async function loadDateFnsLocale(pref: LocalePref): Promise<Locale | undefined> {
  const tag = pref === AUTO ? (import.meta.client ? navigator.language : '') : pref;
  if (!tag) return undefined;
  const lang = tag.split('-')[0]!.toLowerCase();
  // English is date-fns's built-in default; loading it would only add a chunk
  // and change nothing, so the default output stays byte-identical.
  if (lang === 'en') return undefined;
  for (const candidate of [tag, lang]) {
    const loader = DATE_FNS_LOADERS[candidate];
    if (loader) {
      try {
        // Each locale module exports the Locale as both `default` and a named
        // export; the subpath type only declares the named one, so fall back to
        // the first exported value.
        const mod = (await loader()) as { default?: Locale } & Record<string, Locale | undefined>;
        return mod.default ?? (Object.values(mod)[0] as Locale | undefined);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

export function useLocaleSettings() {
  const config = useRuntimeConfig();
  const envLocale = (config.public.dateLocale as string | undefined) ?? '';
  const envTimeZone = (config.public.dateTimeZone as string | undefined) ?? '';

  // Seeded from the env layer (or the built-in default) so the first render is
  // right whenever env pins the format; `refreshInstance()` adds the stored
  // app-setting layer once the API answers.
  const instance = useState<InstanceLocaleState>('piwi-locale-instance', () => {
    const loc = resolveInstanceLocale(envLocale, null);
    const tz = resolveInstanceTimeZone(envTimeZone, null);
    return {
      locale: loc.locale,
      timeZone: tz.timeZone,
      localeEnvManaged: loc.envManaged,
      timeZoneEnvManaged: tz.envManaged,
      defaults: { locale: BUILTIN_LOCALE, timeZone: AUTO },
    };
  });

  const userLocale = useLocalStorage(USER_LOCALE_KEY, FOLLOW_SYSTEM);
  const userTimeZone = useLocalStorage(USER_TIME_ZONE_KEY, FOLLOW_SYSTEM);

  const effectiveLocale = computed(() => foldLocale(userLocale.value, instance.value.locale));
  const effectiveTimeZone = computed(() => foldTimeZone(userTimeZone.value, instance.value.timeZone));

  /** Push the effective prefs into the shared formatter holder. */
  async function applyActive(): Promise<void> {
    const dateFnsLocale = await loadDateFnsLocale(effectiveLocale.value);
    setActiveLocalePrefs({ locale: effectiveLocale.value, timeZone: effectiveTimeZone.value, dateFnsLocale });
  }

  /** Pull the instance default from the API (adds the stored app-setting layer). */
  async function refreshInstance(): Promise<void> {
    try {
      instance.value = await $fetch<InstanceLocaleState>('/api/settings/locale');
    } catch {
      // Keep the env/built-in seed on failure.
    }
  }

  /** Save the instance default (administrator only). A field is omitted to leave it, `null` to reset it. */
  async function saveInstance(body: { locale?: string | null; timeZone?: string | null }): Promise<void> {
    instance.value = await $fetch<InstanceLocaleState>('/api/settings/locale', { method: 'PUT', body });
  }

  /** Sample of how a locale/zone pair formats, for the settings preview. */
  function preview(locale: LocalePref, timeZone: TimeZonePref, date: DateInput = SAMPLE_DATE): string {
    return formatAbsolute(date, { locale, timeZone });
  }

  return {
    instance,
    userLocale,
    userTimeZone,
    effectiveLocale,
    effectiveTimeZone,
    supportedLocales: SUPPORTED_LOCALES,
    timeZoneOptions: listTimeZoneOptions(),
    applyActive,
    refreshInstance,
    saveInstance,
    preview,
  };
}
