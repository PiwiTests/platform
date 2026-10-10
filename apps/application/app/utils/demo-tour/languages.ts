/**
 * The languages the demo's guided tour speaks. The rest of the dashboard is in
 * English, so the tour's copy names the dashboard's labels in English, exactly
 * as the screen shows them.
 *
 * A language is its code here, its entry in `TOUR_LANGUAGE_INFO` and its copy
 * file (`copy.<code>.ts`, registered in `TOUR_COPY`): once the code is added,
 * the compiler asks for both.
 */
export const TOUR_LANGUAGES = ['en', 'fr', 'es', 'de'] as const;

export type TourLanguage = (typeof TOUR_LANGUAGES)[number];

export const TOUR_LANGUAGE_INFO: Record<TourLanguage, { label: string; englishName: string }> = {
  // `label` is written in the language it names, so a reader recognizes their own.
  en: { label: 'English', englishName: 'English' },
  fr: { label: 'Français', englishName: 'French' },
  es: { label: 'Español', englishName: 'Spanish' },
  de: { label: 'Deutsch', englishName: 'German' },
};

export const DEFAULT_TOUR_LANGUAGE: TourLanguage = 'en';

export function isTourLanguage(value: unknown): value is TourLanguage {
  return typeof value === 'string' && (TOUR_LANGUAGES as readonly string[]).includes(value);
}

/**
 * The first tour language among the browser's preferred ones (`navigator.languages`),
 * matched on the primary subtag (`fr-CA` → `fr`), else English.
 */
export function pickTourLanguage(preferred: readonly string[]): TourLanguage {
  for (const tag of preferred) {
    const primary = tag.split('-')[0]?.toLowerCase();
    if (isTourLanguage(primary)) return primary;
  }
  return DEFAULT_TOUR_LANGUAGE;
}
