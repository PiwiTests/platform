/**
 * Selection model — the declarative shape of a named, data-driven test subset,
 * plus the result of resolving one against a project's test catalog.
 *
 * A definition is rules over catalog facts, never a frozen list of ids, so a
 * saved selection keeps tracking the suite as tests are added, renamed and
 * removed. Shared by the server (CRUD + resolver) and the demo mirror.
 */

/** Priority values a test can carry (`piwi:priority` annotation). */
export type SelectionPriority = 'critical' | 'high' | 'medium' | 'low';

/**
 * One AND-ed group of predicates. Every field present must hold for a test to
 * match the group; an empty group `{}` matches every test. All fields optional.
 */
export interface SelectionPredicateGroup {
  /** The test's stable id is one of these (used to pin an exact set, e.g. a mined smoke suite). */
  ids?: number[];
  /** Test carries every one of these tags ('@' stripped, case-insensitive). */
  tags?: string[];
  /** Test carries at least one of these tags. */
  anyTags?: string[];
  /** Test's owner is one of these. */
  owner?: string[];
  /** Test's priority is one of these. */
  priority?: SelectionPriority[];
  /** Test's feature is one of these. */
  feature?: string[];
  /** File path matches one of these globs (`**`, `*`, `?`). */
  files?: string[];
  /** Suite path (describe chain) contains this substring, case-insensitive. */
  suitePath?: string;
  /** Title or file path contains this substring, case-insensitive. */
  text?: string;
  /** Whether the test is currently quarantined. */
  quarantined?: boolean;
  /** Whether the test is flaky (a retry-pass in its last 10 executions). */
  flaky?: boolean;
  /** Minimum pass rate over executed runs, 0..1 inclusive. */
  minPassRate?: number;
  /** Maximum pass rate over executed runs, 0..1 inclusive. */
  maxPassRate?: number;
  /** Minimum average execution duration in milliseconds. */
  minAvgDurationMs?: number;
  /** Maximum average execution duration in milliseconds. */
  maxAvgDurationMs?: number;
  /** Latest execution's status is one of these. */
  lastStatus?: string[];
  /** The test failed within its most recent N executions (N capped at 25). */
  failedInLastRuns?: number;
  /** The test has no recorded executions at all. */
  neverRun?: boolean;
}

/** How a budgeted or limited selection orders tests before it cuts. */
export type SelectionRankBy =
  /** Least reliable first — `1 - passRate`, unknown treated as 0.5. */
  | 'failureLikelihood'
  /** Most recently failed first. */
  | 'recentFailure'
  /** Declared priority, critical → low. */
  | 'priority'
  /** Longest average duration first. */
  | 'slowest'
  /** Shortest average duration first. */
  | 'fastest';

/** Manual per-test overrides layered on top of the predicate result. */
export interface SelectionPins {
  /** test_case ids forced into the result regardless of predicates. */
  add?: number[];
  /** test_case ids removed from the result regardless of predicates. */
  remove?: number[];
}

/** A wall-clock budget that turns a selection into a knapsack. */
export interface SelectionBudget {
  /** Take ranked tests until their summed average duration hits this cap. */
  maxTotalDurationMs?: number;
  /** How to rank before taking. Defaults to `failureLikelihood`. */
  rankBy?: SelectionRankBy;
}

/**
 * A selection definition: OR-ed include groups, minus OR-ed exclude groups,
 * with pins, a budget and a hard limit applied in that order.
 */
export interface SelectionDefinition {
  /** A test must match at least one group. Missing/empty = start from all tests. */
  include?: SelectionPredicateGroup[];
  /** A test matching any group is dropped. */
  exclude?: SelectionPredicateGroup[];
  /** Manual add/remove overrides by test_case id. */
  pins?: SelectionPins;
  /** Budget applied after include/exclude/pins. */
  budget?: SelectionBudget;
  /** Hard cap on the number of tests, applied last. */
  limit?: number;
}

/** A stored selection row as the API returns it. */
export interface Selection {
  key: string;
  name: string;
  description: string | null;
  definition: SelectionDefinition;
  version: number;
  /** True for the implicit `failed` / `quarantine-free` selections. */
  builtin?: boolean;
  createdBy?: number | null;
  createdAt?: number | null;
  updatedAt?: number | null;
}

/** One test in a resolution, carrying just what materialization and display need. */
export interface ResolvedTest {
  testCaseId: number;
  filePath: string;
  suitePath: string;
  title: string;
  line: number | null;
  avgDurationMs: number | null;
  /** Lock names this test most recently declared, driving lock-aware sharding. */
  locks: string[];
}

/** A non-fatal note attached to a resolution. */
export interface SelectionWarning {
  /** Stable identifier a caller can branch on. */
  code:
    | 'quarantined-included'
    | 'pin-not-found'
    | 'budget-evicted-pin'
    | 'grep-overselects'
    | 'materialization-truncated'
    | 'impact-widened'
    | 'split-lock';
  message: string;
}

/** The Playwright arguments a resolution materializes to. */
export type SelectionFormat = 'args' | 'grep' | 'files' | 'json';

export interface MaterializedSelection {
  /** The format actually produced — may differ from the request after a length fallback. */
  format: SelectionFormat;
  /** Bare tokens to append to `playwright test` (no shell quoting). Empty for `json`. */
  args: string[];
  /** A copy-pasteable `npx playwright test …` command. Empty for `json`. */
  command: string;
}

/** The full result of resolving a definition against the catalog. */
export interface ResolvedSelection {
  /** The selection's key, or null for an ad-hoc preview. */
  key: string | null;
  /** The definition version resolved, or null for an ad-hoc preview. */
  version: number | null;
  tests: ResolvedTest[];
  /** SHA-256 over the sorted stable test identities. */
  resolvedHash: string;
  estimate: {
    count: number;
    /** Summed average duration in ms; null when no test has a known duration. */
    totalDurationMs: number | null;
  };
  warnings: SelectionWarning[];
  /** The default materialization (`args` format unless overridden by the caller). */
  materialization: MaterializedSelection;
}
