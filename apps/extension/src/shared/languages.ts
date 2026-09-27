/**
 * The languages Piwi Picker ships, by their `public/_locales/` directory
 * name. A draft is a translation no native reader has reviewed yet; this is
 * the one place a language changes status.
 */
export const SHIPPED_LANGUAGES = [
  { code: 'en', draft: false },
  { code: 'fr', draft: false },
] as const;

export type Language = (typeof SHIPPED_LANGUAGES)[number]['code'];

export const LANGUAGES: readonly Language[] = SHIPPED_LANGUAGES.map((language) => language.code);
