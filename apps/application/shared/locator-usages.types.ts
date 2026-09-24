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
  testCount: number;
  sites: LocatorUsageSite[];
  /** True when more rows matched than were returned. */
  truncated: boolean;
}
