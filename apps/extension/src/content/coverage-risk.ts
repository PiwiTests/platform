/**
 * The coverage overlay's "At risk" tab, pure half: the locators of a scan
 * likely to break. A brittle locator (`@piwitests/core/locator-stability`)
 * breaks on changes unrelated to what its test checks; for one that finds a
 * single element here, a replacement is built from that element, kept only
 * when the same rules call it stable and the engine finds only that element
 * with it, and chosen with locator healing's ladder so the test keeps its
 * style when that style is stable.
 *
 * With the pages each use was made on (the capture fixtures record them), two
 * more risks show on the page open: a chain a test uses here that finds
 * nothing now (Missing here), and one a test clicks here that finds several
 * elements, where a click needs exactly one (Several match here).
 *
 * DOM-only logic, no `chrome.*`: the overlay wires it to the panel and cards.
 */
import { parseLeafLocatorCall, tryParseLocatorChain } from '@piwitests/core/locator-chain';
import { recommendLocatorFix } from '@piwitests/core/locator-fix';
import type { RankedLocator } from '@piwitests/core/locator-healing-types';
import type { LocatorIndex, LocatorIndexTestStatus, LocatorIndexUse } from '@piwitests/core/locator-index';
import { isInteractionAction } from '@piwitests/core/step-locators';
import { assessLocatorChain, type LocatorStability } from '@piwitests/core/locator-stability';
import type { CoverageScan } from './coverage-scan.js';
import type { LocatorEngine } from './locator-engine.js';

const stabilityCache = new WeakMap<LocatorIndex, Array<LocatorStability | null>>();

/** The stability of every chain of the index, judged once per index; null where a chain cannot be read. */
export function chainStabilities(index: LocatorIndex): Array<LocatorStability | null> {
  let stabilities = stabilityCache.get(index);
  if (!stabilities) {
    stabilities = index.locators.map((entry) => {
      const chain = tryParseLocatorChain(entry.locator);
      return chain ? assessLocatorChain(chain) : null;
    });
    stabilityCache.set(index, stabilities);
  }
  return stabilities;
}

/** A brittle chain that finds something on the page (or inside the element the view is limited to). */
export interface BrittleRow {
  /** Position of the chain in `LocatorIndex.locators`. */
  entry: number;
  stability: LocatorStability;
  /** The elements it finds, in page order. */
  elements: Element[];
  /** How many elements it finds on the whole page. */
  count: number;
  /** Positions in `LocatorIndex.tests` of the tests using it, failing and flaky ones first. */
  tests: number[];
  /** Project-relative call sites, as the index records them. */
  callSites: string[];
}

const STATUS_RANK: Record<LocatorIndexTestStatus, number> = { failed: 0, flaky: 1, passed: 2, skipped: 3 };
const statusRank = (status: LocatorIndexTestStatus | null) => (status ? STATUS_RANK[status] : 4);

/**
 * The brittle chains of a scan, one row per chain: those used by a failing or
 * flaky test first (a brittle locator is a likely suspect there), then those
 * shared by the most tests, then in page order.
 */
export function brittleRows(scan: CoverageScan, index: LocatorIndex): BrittleRow[] {
  const stabilities = chainStabilities(index);
  const found = new Map<number, { elements: Element[]; count: number; order: number }>();
  scan.covered.forEach((covered, order) => {
    for (const match of covered.matches) {
      if (stabilities[match.entry]?.level !== 'brittle') continue;
      let row = found.get(match.entry);
      if (!row) found.set(match.entry, (row = { elements: [], count: match.count, order }));
      row.elements.push(covered.element);
    }
  });
  const rows = [...found.entries()].map(([entry, { elements, count, order }]) => {
    const uses = index.locators[entry]!.uses;
    const tests = [...new Set(uses.map((use) => use.test))].sort(
      (a, b) => statusRank(index.tests[a]!.status) - statusRank(index.tests[b]!.status) || a - b,
    );
    const callSites = [...new Set(uses.flatMap((use) => use.callSites))];
    const row: BrittleRow = { entry, stability: stabilities[entry]!, elements, count, tests, callSites };
    return { row, order, rank: tests.length ? statusRank(index.tests[tests[0]!]!.status) : 4 };
  });
  rows.sort(
    (a, b) => Math.min(a.rank, 2) - Math.min(b.rank, 2) || b.row.tests.length - a.row.tests.length || a.order - b.order,
  );
  return rows.map(({ row }) => row);
}

/** What the At risk tab offers for a locator that finds one element. */
export type Replacement =
  | {
      kind: 'replace';
      /** The replacement, in the brittle locator's own style when that style is stable. */
      recommended: RankedLocator;
      /** The most stable replacement, when it differs from the recommended one. */
      durable: RankedLocator | null;
    }
  /** No stable locator finds only this element: it needs a test id. */
  | { kind: 'add-test-id' };

export interface ReplacementOptions {
  /** The page the replacement must work on. */
  doc: Document;
  /** An engine over that page as it is now, built for the current scan. */
  engine: LocatorEngine;
  /** Every locator ranked for the element, most stable first (`rankElementLocators`). */
  rank(element: Element): RankedLocator[];
}

/**
 * A replacement for `locator`, which finds `element` and only it here. Null
 * when none can be offered from this page: the element sits in a frame, whose
 * locators would need the frame's own prefix.
 */
export function replacementFor(element: Element, locator: string, options: ReplacementOptions): Replacement | null {
  if (element.ownerDocument !== options.doc) return null;
  let ranked: RankedLocator[];
  try {
    ranked = options.rank(element);
  } catch {
    return null;
  }
  const candidates = ranked.filter((candidate) => {
    const chain = tryParseLocatorChain(candidate.locator);
    if (!chain || assessLocatorChain(chain).level !== 'stable') return false;
    try {
      const found = options.engine.queryAll(chain);
      return found.length === 1 && found[0] === element;
    } catch {
      return false;
    }
  });
  if (candidates.length === 0) return { kind: 'add-test-id' };
  const fix = recommendLocatorFix(parseLeafLocatorCall(locator)?.method, candidates);
  return {
    kind: 'replace',
    recommended: fix.recommended!,
    durable: fix.hasDurableAlternative ? fix.durable : null,
  };
}

/** Call sites listed in a copied edit, at most. */
const EDIT_SITES = 10;

/**
 * The edit to make, as text to paste into a ticket or an agent: each call
 * site with the old and the new locator.
 *
 *     tests/pages/settings.ts:42:18
 *     - locator('.btn-primary').nth(1)
 *     + getByRole('button', { name: 'Save' })
 */
export function editText(callSites: string[], from: string, to: string): string {
  const change = [`- ${from}`, `+ ${to}`];
  if (callSites.length === 0) return change.join('\n');
  const blocks = callSites.slice(0, EDIT_SITES).map((site) => [site, ...change].join('\n'));
  if (callSites.length > EDIT_SITES) blocks.push(`… and ${callSites.length - EDIT_SITES} more call sites`);
  return blocks.join('\n\n');
}

// ── Pages ────────────────────────────────────────────────────────────────

/** Where a use was made, relative to the page open. */
export type UsePlace = 'here' | 'elsewhere' | 'unknown';

/**
 * Where `use` was made relative to the page at `pagePosition` in
 * `LocatorIndex.pages` (-1 when no use was recorded on it). A use with no page
 * recorded is `unknown`, and so is one recorded on more pages than the index
 * lists, when this page is not among those listed: it counts here, but never
 * warns.
 */
export function usePlace(use: LocatorIndexUse, pagePosition: number): UsePlace {
  if (!use.pages || use.pages.length === 0) return 'unknown';
  if (pagePosition >= 0 && use.pages.includes(pagePosition)) return 'here';
  return use.pagesTruncated ? 'unknown' : 'elsewhere';
}

/** Assertions that pass without the element, or with several of them. */
const ABSENCE_OR_COUNT = new Set(['expect.toBeHidden', 'expect.toHaveCount', 'expect.toBeDetached']);

/** An action that fails when the element is not there: an interaction, or a positive assertion. */
export function needsElement(action: string): boolean {
  if (isInteractionAction(action)) return true;
  return action.startsWith('expect.') && !action.startsWith('expect.not.') && !ABSENCE_OR_COUNT.has(action);
}

/** A chain a test uses on this page that finds nothing now, or several elements where a click needs one. */
export interface PageRiskRow {
  entry: number;
  /** The tests using it on this page, failing and flaky ones first. */
  tests: number[];
  callSites: string[];
  /** What those tests do with it here that the page now fails. */
  actions: string[];
  /** The Playwright projects those uses ran in. */
  projects: string[];
  /** A test used it on this page before any locator interaction there: the element should be there as the page loads. */
  arrival: boolean;
  /** How many elements it finds here now. */
  count: number;
}

function riskRow(
  index: LocatorIndex,
  entry: number,
  uses: LocatorIndexUse[],
  actions: string[],
  pagePosition: number,
  count: number,
): PageRiskRow {
  return {
    entry,
    tests: [...new Set(uses.map((use) => use.test))].sort(
      (a, b) => statusRank(index.tests[a]!.status) - statusRank(index.tests[b]!.status) || a - b,
    ),
    callSites: [...new Set(uses.flatMap((use) => use.callSites))],
    actions,
    projects: [...new Set(uses.flatMap((use) => use.projects))],
    arrival: uses.some((use) => use.arrival?.includes(pagePosition)),
    count,
  };
}

/**
 * The page's risks from a finished scan's per-chain counts (`found`):
 * - **missing**: chains with a use on this page that needs the element (an
 *   interaction or a positive assertion) and that find nothing now, those used
 *   as the page loads first;
 * - **several**: chains a test operates on this page that find more than one
 *   element, which a click or a fill refuses in Playwright's strict mode.
 * Nothing without a page: `pagePosition` is -1 when no use was recorded here.
 */
export function pageRisks(
  index: LocatorIndex,
  found: readonly number[],
  pagePosition: number,
): { missing: PageRiskRow[]; several: PageRiskRow[] } {
  const missing: PageRiskRow[] = [];
  const several: PageRiskRow[] = [];
  if (pagePosition < 0) return { missing, several };
  index.locators.forEach((locator, entry) => {
    const count = found[entry] ?? -1;
    if (count < 0 || count === 1) return;
    const here = locator.uses.filter((use) => usePlace(use, pagePosition) === 'here');
    if (here.length === 0) return;
    if (count === 0) {
      const needing = here.filter((use) => use.actions.some(needsElement));
      if (needing.length === 0) return;
      const actions = [...new Set(needing.flatMap((use) => use.actions.filter(needsElement)))];
      missing.push(riskRow(index, entry, needing, actions, pagePosition, 0));
    } else {
      const operating = here.filter((use) => use.actions.some(isInteractionAction));
      if (operating.length === 0) return;
      const actions = [...new Set(operating.flatMap((use) => use.actions.filter(isInteractionAction)))];
      several.push(riskRow(index, entry, operating, actions, pagePosition, count));
    }
  });
  missing.sort((a, b) => Number(b.arrival) - Number(a.arrival) || b.tests.length - a.tests.length || a.entry - b.entry);
  several.sort((a, b) => b.tests.length - a.tests.length || a.entry - b.entry);
  return { missing, several };
}
