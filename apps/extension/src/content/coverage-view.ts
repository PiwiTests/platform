import type { LocatorIndex, LocatorIndexTest, LocatorIndexTestStatus } from '@piwitests/core/locator-index';
import type { LocatorStability } from '@piwitests/core/locator-stability';
import type { BrittleRow, PageRiskRow } from './coverage-risk.js';
import type { CoverageScan, CoveredElement, ScopedScan } from './coverage-scan.js';

/** Everything the coverage UI draws from once a scan has run. */
export interface CoverageContext {
  index: LocatorIndex;
  /** The whole page's scan, or its part inside the element the reader limited the view to. */
  scan: CoverageScan | ScopedScan;
  instanceUrl: string;
  projectId: number;
  projectLabel: string;
  /** The branch read: a name, `*` for every branch, null for the default branch. */
  branch: string | null;
  /** The stability of each chain of the index, by position. */
  stabilities: Array<LocatorStability | null>;
  /** The brittle chains finding something in `scan`. */
  brittle: BrittleRow[];
  /** The elements those chains find. */
  brittleElements: Set<Element>;
  /** The key of the page open (`/orders/:id`); null off an http(s) page. */
  pageKey: string | null;
  /** Its position in `index.pages`; -1 when no use was recorded on it. */
  pagePosition: number;
  /** The index records pages, so the view can be limited to this page. */
  hasPages: boolean;
  /** The view counts only the uses made on this page, or of unknown page. */
  pageScoped: boolean;
  /** In a page-scoped view: elements only chains used on other pages find, with those chains. */
  elsewhere: Map<Element, number[]>;
  /** In a page-scoped view: chains used here that find nothing now. */
  missing: PageRiskRow[];
  /** In a page-scoped view: chains operated here that find several elements. */
  several: PageRiskRow[];
}

export type CoverageTab = 'elements' | 'tests' | 'untested' | 'risk';

/** What the reader chose to look at. */
export interface ViewState {
  tab: CoverageTab;
  query: string;
  showOperated: boolean;
  showChecked: boolean;
  showUncovered: boolean;
  heatmap: boolean;
  /** Mark the elements a brittle locator finds. */
  showBrittle: boolean;
  /** Count what tests do on this page only, or on every page (today's view without pages). */
  pageScope: 'page' | 'all';
  /** A test pinned from the Tests list: only its elements stand out. */
  focusTest: number | null;
  /** A test hovered in the Tests list. */
  hoverTest: number | null;
  /** An element hovered in a list, flashed on the page. */
  hoverElement: Element | null;
  /** The element whose detail card is open. */
  pinned: Element | null;
  collapsed: boolean;
  dock: 'right' | 'left';
  /** The element the view is limited to, with what is inside it; null for the whole page. */
  scope: Element | null;
  /** The reader is choosing that element on the page. */
  choosingScope: boolean;
}

export function initialViewState(): ViewState {
  return {
    tab: 'elements',
    query: '',
    showOperated: true,
    showChecked: true,
    showUncovered: true,
    heatmap: false,
    showBrittle: true,
    pageScope: 'page',
    focusTest: null,
    hoverTest: null,
    hoverElement: null,
    pinned: null,
    collapsed: false,
    dock: 'right',
    scope: null,
    choosingScope: false,
  };
}

export function isScoped(scan: CoverageScan | ScopedScan): scan is ScopedScan {
  return 'scope' in scan;
}

/** `Suite › Sub-suite › title`. */
export function testTitle(test: LocatorIndexTest): string {
  return [...test.suite, test.title].join(' › ');
}

/** The worst latest outcome among some tests — failed before flaky; null when none failed or was flaky. */
export function worstStatus(index: LocatorIndex, tests: number[]): 'failed' | 'flaky' | null {
  let worst: 'failed' | 'flaky' | null = null;
  for (const t of tests) {
    const status = index.tests[t]?.status;
    if (status === 'failed') return 'failed';
    if (status === 'flaky') worst = 'flaky';
  }
  return worst;
}

export function statusLabel(status: LocatorIndexTestStatus | null): string {
  switch (status) {
    case 'passed':
      return 'Passed in its latest run';
    case 'flaky':
      return 'Passed after a retry in its latest run';
    case 'failed':
      return 'Failed in its latest run';
    case 'skipped':
      return 'Skipped in its latest run';
    default:
      return 'No recorded run';
  }
}

/** Whether a covered element passes the kind filters. */
export function kindShown(state: ViewState, covered: CoveredElement): boolean {
  return covered.kind === 'operated' ? state.showOperated : state.showChecked;
}

/** The test whose elements stand out right now: a hovered one, else the pinned focus. */
export function spotlightTest(state: ViewState): number | null {
  return state.hoverTest ?? state.focusTest;
}

/** The page keys of a use, with the ones it ran on as the page loaded marked. */
export function usePages(index: LocatorIndex, use: { pages?: number[]; arrival?: number[] }): string[] {
  return (use.pages ?? []).map((i) => {
    const page = index.pages?.[i] ?? '?';
    return use.arrival?.includes(i) ? `${page}, as it loads` : page;
  });
}

/** The count of At risk rows. */
export function riskCount(context: CoverageContext): number {
  return context.missing.length + context.several.length + context.brittle.length;
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** "3 min ago" style age for the index freshness line. */
export function ageLabel(fromMs: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.round((nowMs - fromMs) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
