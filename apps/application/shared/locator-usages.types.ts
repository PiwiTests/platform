/**
 * Response shapes of the locator index endpoints, shared by the server, the
 * demo mirror and the dashboard.
 */

/** One locator an execution used, in step order, with how widely it is used. */
export interface ExecutionLocatorUse {
  /** Position of the first step that used it. */
  stepIndex: number;
  /** How many steps of this execution used it from the same call site for the same action. */
  occurrences: number;
  /** `click`, `fill`, `selectOption`, `expect.toHaveValue`, … */
  action: string;
  /** Canonical chain, e.g. `getByRole('form', { name: 'Shipping' }).getByLabel('Country')`. */
  locator: string;
  /** The last locating call, e.g. `getByLabel('Country')`. */
  target: string;
  /** The containers the chain searches inside, outermost first. */
  scopes: string[];
  /** Project-relative `file:line:col`, or null when the step had no location. */
  callSite: string | null;
  /** Distinct tests in the project whose steps used this exact chain. */
  sameLocatorTests: number;
  /** Distinct tests whose chains end on the same target call, whatever their containers. */
  sameTargetTests: number;
}

export interface ExecutionLocatorsResult {
  projectId: number;
  /** The branch of the execution's run, whose view of the index the counts come from; null when the run had none. */
  branch: string | null;
  uses: ExecutionLocatorUse[];
  /** False when the execution stored no steps, so nothing could be read. */
  hasSteps: boolean;
}

/** How a usage query matches chains. */
export type LocatorUsageMatch = 'locator' | 'target' | 'scope' | 'search';

export interface LocatorUsageTest {
  testCaseId: number;
  title: string;
  filePath: string;
  suitePath: string | null;
}

/** One call site that uses a matching chain, with the tests that go through it. */
export interface LocatorUsageSite {
  callSite: string | null;
  locator: string;
  actions: string[];
  tests: LocatorUsageTest[];
  lastSeenAt: string;
}

export interface LocatorUsagesResult {
  match: LocatorUsageMatch;
  value: string;
  /** The branch the uses come from (see `LocatorIndex.branch`); null for every branch together. */
  branch: string | null;
  testCount: number;
  sites: LocatorUsageSite[];
  /** True when more rows matched than were returned. */
  truncated: boolean;
}

export const LOCATOR_USAGE_MATCHES: readonly LocatorUsageMatch[] = ['locator', 'target', 'scope', 'search'];
export const LOCATOR_USAGE_VALUE_MAX_CHARS = 2000;

/**
 * Validate a usage query's `match` and `value`, shared by the endpoint and the
 * demo mirror. Returns the parsed query, or the message to answer with a 400.
 */
export function parseLocatorUsageQuery(
  match: unknown,
  value: unknown,
): { match: LocatorUsageMatch; value: string } | { error: string } {
  const m = String(match ?? '') as LocatorUsageMatch;
  const v = typeof value === 'string' ? value.trim() : '';
  if (!LOCATOR_USAGE_MATCHES.includes(m)) return { error: 'match must be locator, target, scope or search' };
  if (!v || v.length > LOCATOR_USAGE_VALUE_MAX_CHARS) {
    return { error: `value must be 1 to ${LOCATOR_USAGE_VALUE_MAX_CHARS} characters` };
  }
  return { match: m, value: v };
}

export const LOCATOR_BRANCH_MAX_CHARS = 255;

/**
 * Validate the optional `branch` query of the locator index endpoints: a branch
 * name, `*` for every branch together, or nothing for the default branch.
 */
export function parseLocatorBranchQuery(value: unknown): { branch: string | undefined } | { error: string } {
  if (value === undefined || value === null || value === '') return { branch: undefined };
  if (typeof value !== 'string' || value.trim().length === 0 || value.length > LOCATOR_BRANCH_MAX_CHARS) {
    return { error: `branch must be a branch name of at most ${LOCATOR_BRANCH_MAX_CHARS} characters, or *` };
  }
  return { branch: value.trim() };
}
