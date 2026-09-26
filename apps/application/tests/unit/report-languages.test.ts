import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';
import { BUILTIN_DASHBOARDS, resolveDashboard } from '#shared/analytics/dashboards';
import { DIMENSIONS, METRICS } from '#shared/analytics/metrics';
import { ANALYTICS_WIDGETS } from '#shared/analytics/registry';
import type { GapClass } from '#shared/handlers/scenario-gaps';
import { BREAKDOWN_GROUP_LABELS } from '#shared/handlers/analytics/metric-breakdown';
import { MOVER_LABELS } from '#shared/handlers/analytics/movers';
import { AGE_GROUPS } from '#shared/handlers/analytics/time-to-fix';
import { makeFormatter } from '#shared/reports/format';
import { REPORT_LANGUAGES, isReportLanguage } from '#shared/reports/languages';
import { REPORT_SENTENCES, sentencesFor } from '#shared/reports/sentences';
import { GAP_TITLE_SAMPLES } from './gap-title-samples';

const source = (path: string) => readFileSync(fileURLToPath(new URL(`../../${path}`, import.meta.url)), 'utf8');

/** The languages a report is translated into: English is the source text. */
const TRANSLATIONS = REPORT_LANGUAGES.filter((language) => language !== 'en');

/** Every gap class, checked by the compiler against `GapClass`. */
const GAP_CLASSES = Object.keys({
  'blind-spot': 1,
  'false-comfort': 1,
  fragile: 1,
  unhandled: 1,
  degraded: 1,
} satisfies Record<GapClass, 1>);

/**
 * Every fixed English label a report passes to `title()`: the built-in
 * dashboards (names, bands, widgets), the widget registry's titles, the
 * breakdown dimensions and the groups Piwi names, the movers and age
 * groups, and the literal column titles of the report code.
 */
function fixedLabels(): string[] {
  const labels = new Set<string>();
  for (const dashboard of BUILTIN_DASHBOARDS) {
    labels.add(dashboard.name);
    for (const band of resolveDashboard(dashboard.definition)) {
      labels.add(band.title);
      if (band.description) labels.add(band.description);
      for (const widget of band.widgets) labels.add(widget.title);
    }
  }
  for (const widget of ANALYTICS_WIDGETS) labels.add(widget.title);
  for (const dimension of DIMENSIONS) labels.add(dimension.label);
  for (const label of BREAKDOWN_GROUP_LABELS) labels.add(label);
  for (const label of Object.values(MOVER_LABELS)) labels.add(label);
  for (const group of AGE_GROUPS) labels.add(group.label);
  const dir = fileURLToPath(new URL('../../shared/reports/', import.meta.url));
  for (const file of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.startsWith('sentences'))) {
    for (const match of readFileSync(`${dir}${file}`, 'utf8').matchAll(/\.title\('((?:[^'\\]|\\.)*)'\)/g)) {
      labels.add(match[1]!);
    }
  }
  return [...labels].sort();
}

describe('the report languages', () => {
  test('the registry lists every language, each with its sentences and its own locale', () => {
    expect(Object.keys(REPORT_SENTENCES)).toEqual([...REPORT_LANGUAGES]);
    expect(REPORT_LANGUAGES[0]).toBe('en');
    for (const language of REPORT_LANGUAGES) {
      expect(isReportLanguage(language)).toBe(true);
      expect(sentencesFor(language).typography.locale.startsWith(language), language).toBe(true);
      expect(makeFormatter(language).language).toBe(language);
    }
    expect(isReportLanguage('xx')).toBe(false);
    expect(isReportLanguage('toString')).toBe(false);
  });

  test('the preview route documents the same languages as the registry', () => {
    // `defineRouteMeta` must stay a literal, so the list is written out there.
    const route = source('server/api/reports/preview.get.ts');
    const documented = /name: 'lang'.*?enum: \[([^\]]*)\]/s.exec(route)?.[1];
    expect(documented?.split(',').map((code) => code.trim().replace(/'/g, ''))).toEqual([...REPORT_LANGUAGES]);
  });

  test.each(TRANSLATIONS)('%s translates every fixed label', (language) => {
    const titles = sentencesFor(language).titles;
    expect(fixedLabels().filter((label) => !Object.hasOwn(titles, label))).toEqual([]);
  });

  test.each(TRANSLATIONS)('%s names and defines every metric', (language) => {
    const s = sentencesFor(language);
    const missing = METRICS.filter(
      (m) => s.metricLabel(m.id, '\u0000') === '\u0000' || s.metricDefinition(m.id, '\u0000') === '\u0000',
    ).map((m) => m.id);
    expect(missing).toEqual([]);
  });

  test.each(TRANSLATIONS)('%s rewrites the title of every gap detector', (language) => {
    const s = sentencesFor(language);
    const untranslated = GAP_TITLE_SAMPLES.filter(([detector, english]) => s.gapTitle(detector, english) === english);
    expect(untranslated.map(([detector, english]) => `${detector}: ${english}`)).toEqual([]);
  });

  test.each(REPORT_LANGUAGES)('%s names every gap class', (language) => {
    const s = sentencesFor(language);
    expect(GAP_CLASSES.filter((cls) => s.gapClass(cls) === cls)).toEqual([]);
  });

  test('every detector that titles a gap has a sample title', () => {
    const detectors = new Set(
      [...source('shared/handlers/scenario-gaps.ts').matchAll(/detector: '([a-z-]+)'/g)].map((m) => m[1]!),
    );
    // A prediction handed to locator healing, never a gap.
    detectors.delete('locator-break-ahead');
    expect([...detectors].filter((d) => !GAP_TITLE_SAMPLES.some(([id]) => id === d))).toEqual([]);
  });
});
