/**
 * The coverage overlay's "At risk" tab, pure half: the locators of a scan
 * likely to break. A brittle locator (`@piwitests/core/locator-stability`)
 * breaks on changes unrelated to what its test checks; for one that finds a
 * single element here, a replacement is built from that element, kept only
 * when the same rules call it stable and the engine finds only that element
 * with it, and chosen with locator healing's ladder so the test keeps its
 * style when that style is stable.
 *
 * DOM-only logic, no `chrome.*`: the overlay wires it to the panel and cards.
 */
import { parseLeafLocatorCall, tryParseLocatorChain } from '@piwitests/core/locator-chain';
import { recommendLocatorFix } from '@piwitests/core/locator-fix';
import type { RankedLocator } from '@piwitests/core/locator-healing-types';
import type { LocatorIndex, LocatorIndexTestStatus } from '@piwitests/core/locator-index';
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
