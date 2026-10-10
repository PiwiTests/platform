/**
 * What the guided tour says, one file per language (`copy.en.ts`, `copy.fr.ts`,
 * …): the tour's own words (`ui`) and each role's label, hint and stops. English
 * is the source; every other file must have exactly its keys.
 *
 * A tour language is its code in `languages.ts` and its copy file, registered in
 * `TOUR_COPY` below: once the code is added, the compiler asks for the file.
 * `tests/unit/demo-tour.test.ts` names every string a language leaves empty or
 * untranslated, and every stop with no copy.
 */
import type { TourLanguage } from './languages';
import type { TourProfileId, TourStopCopy } from './types';
import { EN_COPY } from './copy.en';
import { FR_COPY } from './copy.fr';
import { ES_COPY } from './copy.es';
import { DE_COPY } from './copy.de';

export type TourCopy = typeof EN_COPY;

/** Each tour language's copy. */
export const TOUR_COPY: Record<TourLanguage, TourCopy> = {
  en: EN_COPY,
  fr: FR_COPY,
  es: ES_COPY,
  de: DE_COPY,
};

export function tourCopyFor(language: TourLanguage): TourCopy {
  return TOUR_COPY[language];
}

/** What one stop's popover says in `language`; `undefined` for a stop with no copy. */
export function stopCopy(language: TourLanguage, profileId: TourProfileId, stopId: string): TourStopCopy | undefined {
  const stops: Record<string, TourStopCopy> = TOUR_COPY[language].profiles[profileId].stops;
  return stops[stopId];
}
