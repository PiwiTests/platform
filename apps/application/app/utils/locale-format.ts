/**
 * The date/time formatting preferences currently in effect for this viewer.
 *
 * Held as a module-level `reactive` singleton so the pure formatters in
 * `app/utils/index.ts` (`prettyDateFormat`, `formatRelativeTime`) can read the
 * effective locale and time zone without every call site threading them
 * through. Reading it inside a component's render/computed tracks it, so every
 * rendered date updates the moment a viewer changes their format.
 *
 * It is written only on the client, by `app/plugins/locale.client.ts`, after it
 * resolves the instance default (env → app setting → built-in) and the viewer's
 * own override. On the server it stays at the built-in default, which is
 * harmless: absolute dates and relative times render client-only (`ClientDate`,
 * `<ClientOnly>`), so the server never emits a formatted date.
 */
import { reactive } from 'vue';
import { AUTO, BUILTIN_LOCALE, type LocalePref, type TimeZonePref } from '#shared/i18n/locale-format';
import type { Locale } from 'date-fns';

export interface ActiveLocalePrefs {
  /** Resolved locale (`'auto'` or a BCP-47 tag). */
  locale: LocalePref;
  /** Resolved time zone (`'auto'` or an IANA zone). */
  timeZone: TimeZonePref;
  /**
   * date-fns locale object for relative-time wording ("il y a 3 heures").
   * `undefined` renders English, which is date-fns's default and keeps the
   * built-in output byte-identical.
   */
  dateFnsLocale?: Locale;
}

const active = reactive<ActiveLocalePrefs>({
  locale: BUILTIN_LOCALE,
  timeZone: AUTO,
  dateFnsLocale: undefined,
});

/** The reactive prefs the formatters read. */
export function activeLocalePrefs(): ActiveLocalePrefs {
  return active;
}

/** Replace the active prefs (called by the client locale plugin). */
export function setActiveLocalePrefs(prefs: ActiveLocalePrefs): void {
  active.locale = prefs.locale;
  active.timeZone = prefs.timeZone;
  active.dateFnsLocale = prefs.dateFnsLocale;
}
