/**
 * A job an editor passes to the desktop app on the same machine: reproduce a
 * failure at its commit, bisect the commits between the last green run and
 * the failing one, or run a flaky test's Flake Lab experiment at the commit of
 * its latest failure. The editor posts it to the app's
 * `POST /api/desktop/repro-requests` with the token from the app's discovery
 * file; the app shows it in its window and runs nothing until the developer
 * starts it there. The editor polls `GET /api/desktop/repro-requests/:id` for
 * the verdict and may share it on the instance the job came from, with its
 * own key: the app never holds that key.
 */
import type { BisectResult } from './bisect';
import type { FlakeCondition, FlakePlanTest } from './flake-plan';

export const DESKTOP_JOB_KINDS = ['reproduce', 'bisect', 'flake-lab'] as const;
export type DesktopJobKind = (typeof DESKTOP_JOB_KINDS)[number];

/** One failing test, as the desktop app runs it: `<filePath>:<line>`, scoped to its Playwright project. */
export interface DesktopJobTest {
  /** The spec's path relative to the Playwright config's directory. */
  filePath: string;
  title: string;
  line?: number | null;
  projectName?: string | null;
}

/** One arm of a Flake Lab job's plan, as `piwi flake` runs it. */
export interface FlakeLabJobArm {
  /** `control`, `suspect-<rank>` or `combined`. */
  id: string;
  label: string;
  suspectId: string | null;
  rank: number | null;
  conditions: FlakeCondition[];
  runs: number;
  /** Stop at this many matching failures; null runs every run. */
  stopAt: number | null;
}

/**
 * The plan of a `flake-lab` job: the reproduce experiment the instance recorded
 * for a test (`GET /api/test-cases/:id/flake-plan`), in the shape
 * `piwi flake --plan <file>` reads. Its ids are the instance's.
 */
export interface FlakeLabJobPlan {
  version: 1;
  /** The experiment the instance recorded, which the results are shared on. */
  experimentId: string | null;
  kind: 'reproduce';
  projectId: number;
  testCaseId: number;
  test: FlakePlanTest;
  displayTitle: string;
  windowDays: number;
  failures: number;
  passes: number;
  /** The commit of the test's latest failure: the one the lab checks out. */
  failureCommit: string | null;
  medianDurationMs: number | null;
  errorSignatures: string[];
  /** Always empty: the lab prints suspects in its text output only, and a job reads its JSON. */
  suspects: [];
  control: FlakeLabJobArm;
  arms: FlakeLabJobArm[];
  combined: FlakeLabJobArm | null;
  verifies: null;
}

/** The request body. It names commits, tests and lab conditions, never code or command-line flags. */
export interface DesktopJobRequest {
  kind: DesktopJobKind;
  /** The failing commit: checked out to reproduce or run the lab, the bad end of a bisect. */
  commit: string;
  /** The last green commit, the good end of a bisect. */
  good?: string | null;
  /** The failing tests; a `flake-lab` job takes its test from `plan`. */
  tests?: DesktopJobTest[];
  /** The browser to install (`chromium`, `firefox`, `webkit`). */
  browser?: string | null;
  title?: string | null;
  /** The instance the failure came from. */
  instanceUrl: string;
  /** The failure cluster on that instance. */
  clusterId?: number | null;
  /** The experiment a `flake-lab` job runs. */
  plan?: FlakeLabJobPlan | null;
}

/** What one arm of a Flake Lab job measured, as `piwi flake --json` prints it. */
export interface FlakeLabJobArmCount {
  id: string;
  runs: number;
  /** Failures with the same error signature as the test's failures in history. */
  matchingFailures: number;
  otherFailures: number;
  discardedRounds: number;
  stoppedEarly: boolean;
}

/** What a Flake Lab job measured: the lab's verdict and the arms that ran, the control first. */
export interface FlakeLabJobReport {
  verdict: 'reproduced' | 'amplified' | 'not-reproduced';
  /** The arm that reproduced the failure. */
  reproducingArm: string | null;
  /** The commit the lab ran. */
  commit: string | null;
  arms: FlakeLabJobArmCount[];
}

/**
 * How a job ended: the failing tests failed again or passed at the commit,
 * the bisect named the first bad commit or could not, the lab measured its
 * arms, or the run could not start or was stopped.
 */
export type DesktopJobVerdict =
  | { kind: 'reproduced' }
  | { kind: 'not-reproduced' }
  | { kind: 'first-bad'; commit: BisectResult }
  | { kind: 'lab'; report: FlakeLabJobReport }
  | { kind: 'error'; reason: string }
  | { kind: 'stopped' };
