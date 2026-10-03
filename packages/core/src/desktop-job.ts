/**
 * A job an editor passes to the desktop app on the same machine: reproduce a
 * failure at its commit, or bisect the commits between the last green run and
 * the failing one. The editor posts it to the app's
 * `POST /api/desktop/repro-requests` with the token from the app's discovery
 * file; the app shows it in its window and runs nothing until the developer
 * starts it there. The editor polls `GET /api/desktop/repro-requests/:id` for
 * the verdict and may share it on the instance the failure came from, with its
 * own key: the app never holds that key.
 */
import type { BisectResult } from './bisect';

export const DESKTOP_JOB_KINDS = ['reproduce', 'bisect'] as const;
export type DesktopJobKind = (typeof DESKTOP_JOB_KINDS)[number];

/** One failing test, as the desktop app runs it: `<filePath>:<line>`, scoped to its Playwright project. */
export interface DesktopJobTest {
  /** The spec's path relative to the Playwright config's directory. */
  filePath: string;
  title: string;
  line?: number | null;
  projectName?: string | null;
}

/** The request body. It names commits and tests, never code or command-line flags. */
export interface DesktopJobRequest {
  kind: DesktopJobKind;
  /** The failing commit: checked out to reproduce, the bad end of a bisect. */
  commit: string;
  /** The last green commit, the good end of a bisect. */
  good?: string | null;
  tests: DesktopJobTest[];
  /** The browser to install (`chromium`, `firefox`, `webkit`). */
  browser?: string | null;
  title?: string | null;
  /** The instance the failure came from. */
  instanceUrl: string;
  /** The failure cluster on that instance. */
  clusterId?: number | null;
}

/**
 * How a job ended: the failing tests failed again or passed at the commit,
 * the bisect named the first bad commit or could not, or the run could not
 * start or was stopped.
 */
export type DesktopJobVerdict =
  | { kind: 'reproduced' }
  | { kind: 'not-reproduced' }
  | { kind: 'first-bad'; commit: BisectResult }
  | { kind: 'error'; reason: string }
  | { kind: 'stopped' };
