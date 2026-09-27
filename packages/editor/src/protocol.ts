/**
 * The Piwi editor service's own requests, beside the language server protocol.
 * Diagnostics, quick fixes and hover go through the protocol; what the two
 * editors render differently (the lines above a file, a test or a locator)
 * goes through these requests, and each client draws them natively: CodeLens
 * in VS Code, Code Vision in the JetBrains IDEs.
 */

/** A command a summary line runs when clicked. Clients implement each `command` id. */
export interface PiwiCommand {
  title: string;
  /** `piwi.openInDashboard` (arguments: `[url]`) or `piwi.runTests` (arguments: `[RunTestsArgs]`). */
  command: 'piwi.openInDashboard' | 'piwi.runTests';
  arguments: unknown[];
}

/** One line of text shown above a line of a file. */
export interface SummaryLine {
  /** 0-based line the text sits above. */
  line: number;
  title: string;
  command?: PiwiCommand;
}

/** `piwi/fileSummary`: what to show above a file and above its test and locator lines. */
export interface FileSummaryParams {
  uri: string;
}

export interface FileSummary {
  /** The line shown at the top of the file; null when Piwi knows nothing about it. */
  file: SummaryLine | null;
  lines: SummaryLine[];
}

export const FILE_SUMMARY_REQUEST = 'piwi/fileSummary';

/** A test as the editors list it. */
export interface EditorTest {
  id: number;
  title: string;
  file: string;
  status: 'passed' | 'flaky' | 'failed' | 'skipped' | null;
  /** The test's page in the dashboard. */
  url: string;
}

/** `piwi/testsForFile`: the tests that reach a file (application code), or that a test file defines. */
export interface TestsForFileParams {
  uri: string;
}

export interface TestsForFile {
  tests: EditorTest[];
  /** How the tests were found: `defined` in a spec file, `reach` through code reach, `locators` through call sites. */
  basis: 'defined' | 'reach' | 'locators' | 'none';
}

export const TESTS_FOR_FILE_REQUEST = 'piwi/testsForFile';

/** `piwi/runArgs`: the command line that runs tests, as `piwi run` builds it. */
export interface RunTestsArgs {
  /** Any file of the workspace the tests belong to, to pick the Playwright config. */
  uri: string;
  testIds: number[];
}

export interface RunCommand {
  /** The directory to run it in: the Playwright config's. */
  cwd: string;
  /** The whole command, ready for a terminal. */
  command: string;
  /** The arguments after `playwright test`. */
  args: string[];
}

export const RUN_ARGS_REQUEST = 'piwi/runArgs';

/** `piwi/status`: what the service is connected to, per workspace context. */
export interface StatusResult {
  contexts: Array<{
    /** The Playwright config's directory. */
    root: string;
    connected: boolean;
    serverUrl: string | null;
    projectId: number | null;
    projectName: string | null;
    branch: string | null;
    locators: number;
    reachedFiles: number;
    /** Why it is not connected, in one sentence. */
    problem: string | null;
  }>;
}

export const STATUS_REQUEST = 'piwi/status';

/** `piwi/refresh`: fetch every index again now. */
export const REFRESH_REQUEST = 'piwi/refresh';

/**
 * `piwi/setCredentials` (notification): the connection the editor's own
 * settings hold, the API key from its secret store. Applied after the
 * environment, the workspace `.env` and the desktop app.
 */
export interface EditorCredentials {
  serverUrl?: string | null;
  apiKey?: string | null;
  project?: string | null;
}

export const SET_CREDENTIALS_NOTIFICATION = 'piwi/setCredentials';
