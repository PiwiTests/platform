/**
 * Why the suite missed a reported bug, read from the project's locator index:
 * the tests that visit the report's page, those whose locators reach an
 * element the reporter marked, and what they do with it. Pure, so the server,
 * the demo and the tests read it the same way.
 */
import { extractLocatorExpressions, lookupLocators, type LocatorIndex } from '@piwitests/core/locator-index';
import { pageKeyUnderPrefix } from '@piwitests/core/page-key';
import type { PiwiSteps } from '@piwitests/core/steps';

export interface MissedByTest {
  testCaseId: number;
  title: string;
  filePath: string;
}

export interface MissedByTarget {
  /** The step (0-based) that marked the element. */
  step: number;
  /** The matcher the reporter expected the element to satisfy (`toHaveText`, …). */
  matcher: string;
  /** Tests whose locators find the element. */
  reaching: MissedByTest[];
  /** Of those, the ones that assert anything about it. */
  asserting: MissedByTest[];
  /** Of those, the ones that assert what the reporter expected (the same matcher). */
  assertingSame: MissedByTest[];
}

export interface MissedBy {
  /** The page the report is about, as the index keys pages. */
  page: string | null;
  /** False when the project's runs recorded no page (no capture fixtures): the visits are unknown. */
  pagesKnown: boolean;
  /** Tests that ran on the page. */
  visiting: MissedByTest[];
  /** One entry per marked element (a missing element or a wrong page has none). */
  targets: MissedByTarget[];
  /** The spec file whose tests visit the page most, to name an owner from. */
  mainFile: string | null;
}

/**
 * The page key of a steps document's path, with the URL mapping's path prefix
 * removed, or null for a path it cannot read.
 */
function keyOf(path: string | null | undefined, origin: string | null, pathPrefix: string | null): string | null {
  if (!path) return null;
  try {
    return pageKeyUnderPrefix(new URL(path, origin ?? 'http://localhost').href, pathPrefix).key;
  } catch {
    return null;
  }
}

/** Why the suite missed a report's bug. */
export function computeMissedBy(
  index: LocatorIndex | null,
  report: { steps: PiwiSteps; pageKey: string | null; pathPrefix?: string | null },
): MissedBy {
  const prefix = report.pathPrefix ?? null;
  const marked = report.steps.steps.flatMap((step, i) =>
    step.action === 'assert' && step.assertion ? [{ step, i }] : [],
  );
  const page =
    keyOf(marked[0]?.step.pageUrl, report.steps.origin, prefix) ??
    report.pageKey ??
    keyOf(report.steps.steps.at(-1)?.pageUrl, null, prefix);
  const empty: MissedBy = { page, pagesKnown: false, visiting: [], targets: [], mainFile: null };
  if (!index) return empty;

  const test = (i: number): MissedByTest | null => {
    const t = index.tests[i];
    return t ? { testCaseId: t.id, title: t.title, filePath: t.file } : null;
  };
  const tests = (ids: Iterable<number>) =>
    [...new Set(ids)].flatMap((i) => {
      const t = test(i);
      return t ? [t] : [];
    });

  const pages = index.pages ?? [];
  const pageIndex = page ? pages.indexOf(page) : -1;
  const pagesKnown = pages.length > 0;
  const onPage = (use: { pages?: number[] }) => pageIndex >= 0 && (use.pages ?? []).includes(pageIndex);

  const visitingIds = index.locators.flatMap((entry) => entry.uses.filter(onPage).map((use) => use.test));
  const visiting = tests(visitingIds);

  const targets: MissedByTarget[] = marked.flatMap(({ step, i }) => {
    const alternatives = step.target?.alternatives ?? [];
    if (!alternatives.length || !step.assertion) return [];
    const inputs = alternatives.flatMap((a) => extractLocatorExpressions(a.locator));
    const hits = lookupLocators(index, inputs).flatMap((lookup) => lookup.hits.filter((h) => h.kind !== 'scope'));
    const reachingIds = new Set<number>();
    const assertingIds = new Set<number>();
    const sameIds = new Set<number>();
    const matcher = step.assertion.matcher;
    for (const hit of hits) {
      const entry = index.locators.find((e) => e.locator === hit.locator);
      for (const use of entry?.uses ?? []) {
        // A use on a known other page reaches another element with the same locator.
        if (pagesKnown && use.pages?.length && pageIndex >= 0 && !use.pages.includes(pageIndex)) continue;
        reachingIds.add(use.test);
        if (use.actions.some((a) => a.startsWith('expect.'))) assertingIds.add(use.test);
        if (use.actions.some((a) => a === `expect.${matcher}` || a === `expect.not.${matcher}`)) sameIds.add(use.test);
      }
    }
    return [
      {
        step: i,
        matcher,
        reaching: tests(reachingIds),
        asserting: tests(assertingIds),
        assertingSame: tests(sameIds),
      },
    ];
  });

  const byFile = new Map<string, number>();
  for (const t of visiting) byFile.set(t.filePath, (byFile.get(t.filePath) ?? 0) + 1);
  const mainFile = [...byFile.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? null;

  return { page, pagesKnown, visiting, targets, mainFile };
}

/** The finding in one line: "4 tests visit /cart; 2 reach the element marked, and none asserts its text". */
export function describeMissedBy(missed: MissedBy): string {
  const count = (n: number, one: string, other: string) => `${n === 0 ? 'no' : n} ${n === 1 ? one : other}`;
  if (!missed.page) return 'The report names no page.';
  if (!missed.pagesKnown)
    return `No run recorded the pages its tests visit, so the tests on ${missed.page} are unknown.`;
  const visits = `${count(missed.visiting.length, 'test visits', 'tests visit')} ${missed.page}`;
  const [target] = missed.targets;
  if (!target) return `${visits}.`.replace(/^no/, 'No');
  const reach = target.reaching.length;
  const verb: Record<string, string> = {
    toHaveText: 'its text',
    toHaveValue: 'its value',
    toHaveAccessibleName: 'its name',
    toHaveURL: 'the URL',
  };
  const what = verb[target.matcher] ?? 'its state';
  const sentence =
    reach === 0
      ? `${visits}, and none reaches the element marked`
      : `${visits}; ${reach} ${reach === 1 ? 'reaches' : 'reach'} the element marked, and ${
          target.assertingSame.length === 0
            ? `none asserts ${what}`
            : `${target.assertingSame.length} ${target.assertingSame.length === 1 ? 'asserts' : 'assert'} ${what}`
        }`;
  return `${sentence.charAt(0).toUpperCase()}${sentence.slice(1)}.`;
}
