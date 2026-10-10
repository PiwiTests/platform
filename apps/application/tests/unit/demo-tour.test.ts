import { describe, expect, test } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TOUR_PROFILES } from '~/utils/demo-tour/profiles';
import { TOUR_COPY, stopCopy } from '~/utils/demo-tour/copy';
import { TOUR_LANGUAGES, type TourLanguage } from '~/utils/demo-tour/languages';
import { boldLabels, plainTourText } from '~/utils/demo-tour/markup';
import type { TourProfileId } from '~/utils/demo-tour/types';

/**
 * The guided tour's registry against its copy and the dashboard's source: every
 * role has one tour of a few stops, every stop has its words in every language,
 * a translation names the same dashboard labels as the English and fits the
 * popover, and every element a stop points at carries its `data-tour` attribute
 * in one component, none left over.
 */

const appDir = fileURLToPath(new URL('../../app', import.meta.url));

/** Every role, once: the compiler asks for a new one here. */
const PROFILE_IDS = Object.keys({
  developer: true,
  qa: true,
  product: true,
  platform: true,
} satisfies Record<TourProfileId, true>);

const MIN_STOPS = 4;
const MAX_STOPS = 7;
const MAX_TITLE = 60;
const MAX_BODY = 360;
const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** One piece of copy, named for a failure message. */
interface CopyEntry {
  name: string;
  /** The same string in English. */
  english: string;
  text: string;
}

/** Every string of one language, keyed like the English, in a fixed order. */
function entriesOf(language: TourLanguage): CopyEntry[] {
  const copy = TOUR_COPY[language];
  const english = TOUR_COPY.en;
  const entries: CopyEntry[] = Object.entries(copy.ui).map(([key, text]) => ({
    name: `ui.${key}`,
    english: english.ui[key as keyof typeof english.ui],
    text,
  }));
  for (const id of PROFILE_IDS as TourProfileId[]) {
    const profile = copy.profiles[id];
    const source = english.profiles[id];
    entries.push({ name: `${id}.label`, english: source.label, text: profile.label });
    entries.push({ name: `${id}.hint`, english: source.hint, text: profile.hint });
    const stops: Record<string, { title: string; body: string }> = profile.stops;
    const sourceStops: Record<string, { title: string; body: string }> = source.stops;
    for (const [stopId, stop] of Object.entries(stops)) {
      entries.push({ name: `${id}/${stopId}.title`, english: sourceStops[stopId]?.title ?? '', text: stop.title });
      entries.push({ name: `${id}/${stopId}.body`, english: sourceStops[stopId]?.body ?? '', text: stop.body });
    }
  }
  return entries.map((entry) => ({ ...entry, name: `${language} ${entry.name}` }));
}

const ALL_ENTRIES = TOUR_LANGUAGES.flatMap(entriesOf);

/** Every `.vue` file of the app, by its path from `app/`. */
const vueFiles = (readdirSync(appDir, { recursive: true }) as string[])
  .filter((path) => path.endsWith('.vue'))
  .map((path) => ({ path, source: readFileSync(join(appDir, path), 'utf8') }));

/** Each static `data-tour` value in the app's components, with the file of each element that sets it. */
const dataTourFiles = new Map<string, string[]>();
for (const { path, source } of vueFiles) {
  for (const match of source.matchAll(/(?<![:\w-])data-tour="([^"]*)"/g)) {
    dataTourFiles.set(match[1]!, [...(dataTourFiles.get(match[1]!) ?? []), path]);
  }
}

describe('tour profiles', () => {
  test('every role has one tour', () => {
    const ids = TOUR_PROFILES.map((p) => p.id);
    expect(
      ids.filter((id, i) => ids.indexOf(id) !== i),
      'roles with two tours',
    ).toEqual([]);
    expect([...ids].sort()).toEqual([...PROFILE_IDS].sort());
  });

  test.each(TOUR_PROFILES.map((p) => [p.id, p] as const))('%s', (id, profile) => {
    expect(profile.stops.length, `${id}: stops`).toBeGreaterThanOrEqual(MIN_STOPS);
    expect(profile.stops.length, `${id}: stops`).toBeLessThanOrEqual(MAX_STOPS);

    const stopIds = profile.stops.map((s) => s.id);
    expect(
      stopIds.filter((s, i) => stopIds.indexOf(s) !== i),
      `${id}: stop ids used twice`,
    ).toEqual([]);
    expect(
      stopIds.filter((s) => !KEBAB.test(s)),
      `${id}: stop ids that are not kebab-case`,
    ).toEqual([]);

    // A stop with no route stays on the page the previous stop opened.
    expect(profile.stops[0]?.route, `${id}: the first stop opens a page`).toBeTruthy();

    // A page reads its query (`?tab=`) when it opens, so the next stop on the same page keeps its route.
    const routed = profile.stops.filter((s) => s.route);
    const pathOf = (route: string) => route.split(/[?#]/)[0];
    expect(
      routed
        .slice(1)
        .filter((s, i) => s.route !== routed[i]!.route && pathOf(s.route!) === pathOf(routed[i]!.route!))
        .map((s) => s.id),
      `${id}: stops that change only the query of the page before them`,
    ).toEqual([]);

    for (const stop of profile.stops) expect(stop.doc, `${id}/${stop.id}: a docs link`).toBeTruthy();
  });
});

describe('tour copy', () => {
  test.each(TOUR_LANGUAGES)('%s: every stop has copy, and no copy is left without a stop', (language) => {
    for (const profile of TOUR_PROFILES) {
      for (const stop of profile.stops) {
        expect(stopCopy(language, profile.id, stop.id), `${language} ${profile.id}/${stop.id}: copy`).toBeDefined();
      }
      const stopIds = new Set(profile.stops.map((s) => s.id));
      expect(
        Object.keys(TOUR_COPY[language].profiles[profile.id].stops).filter((id) => !stopIds.has(id)),
        `${language} ${profile.id}: copy for stops the tour does not have`,
      ).toEqual([]);
    }
  });

  test('every string is written in every language', () => {
    expect(ALL_ENTRIES.filter((e) => !e.text.trim()).map((e) => e.name)).toEqual([]);
  });

  test('a translation keeps the placeholders of its English', () => {
    const placeholders = (text: string) => [...text.matchAll(/\{\{?\w+\}\}?/g)].map((m) => m[0]).sort();
    const broken = ALL_ENTRIES.filter(
      (e) => JSON.stringify(placeholders(e.text)) !== JSON.stringify(placeholders(e.english)),
    ).map((e) => `${e.name}: ${placeholders(e.text).join(' ')} for ${placeholders(e.english).join(' ')}`);
    expect(broken).toEqual([]);
  });

  test('a stop’s body is translated, not copied from the English', () => {
    const copied = ALL_ENTRIES.filter((e) => !e.name.startsWith('en ') && e.name.endsWith('.body'))
      .filter((e) => e.text === e.english)
      .map((e) => e.name);
    expect(copied).toEqual([]);
  });

  // The dashboard stays in English, so a translation quotes its labels as the screen spells them.
  test('a translation names the same bold dashboard labels as the English, in order', () => {
    const broken = ALL_ENTRIES.filter(
      (e) => JSON.stringify(boldLabels(e.text)) !== JSON.stringify(boldLabels(e.english)),
    ).map((e) => `${e.name}: ${JSON.stringify(boldLabels(e.text))} for ${JSON.stringify(boldLabels(e.english))}`);
    expect(broken).toEqual([]);
  });

  test(`a title fits in ${MAX_TITLE} characters and a body in ${MAX_BODY}`, () => {
    const tooLong = ALL_ENTRIES.flatMap((e) => {
      const max = e.name.endsWith('.title') ? MAX_TITLE : e.name.endsWith('.body') ? MAX_BODY : null;
      const length = plainTourText(e.text).length;
      return max !== null && length > max ? [`${e.name}: ${length} characters`] : [];
    });
    expect(tooLong).toEqual([]);
  });

  test('no copy carries markup of its own', () => {
    expect(ALL_ENTRIES.filter((e) => /[<>]/.test(e.text)).map((e) => e.name)).toEqual([]);
  });
});

describe('tour targets', () => {
  const stops = TOUR_PROFILES.flatMap((profile) =>
    profile.stops.map((stop) => ({ name: `${profile.id}/${stop.id}`, stop })),
  );

  test('every target and folded section is the data-tour of one element', () => {
    const problems: string[] = [];
    for (const { name, stop } of stops) {
      for (const [field, value] of [
        ['target', stop.target],
        ['unfold', stop.unfold],
      ] as const) {
        if (value === undefined) continue;
        const files = dataTourFiles.get(value) ?? [];
        if (files.length !== 1) {
          problems.push(`${name}: ${field} "${value}" is set on ${files.length} elements (${files.join(', ')})`);
        }
      }
    }
    expect(problems).toEqual([]);
  });

  test('every data-tour in the app is a stop’s target or folded section', () => {
    const used = new Set(stops.flatMap(({ stop }) => [stop.target, stop.unfold].filter((v) => v !== undefined)));
    expect([...dataTourFiles.keys()].filter((value) => !used.has(value))).toEqual([]);
  });

  test('every data-tour is a static, kebab-case value', () => {
    expect([...dataTourFiles.keys()].filter((value) => !KEBAB.test(value))).toEqual([]);
    const bound = vueFiles.filter(({ source }) => /(?<![\w-])(?:v-bind)?:data-tour\b/.test(source));
    expect(
      bound.map(({ path }) => path),
      'a bound data-tour cannot be found in the source',
    ).toEqual([]);
  });
});
