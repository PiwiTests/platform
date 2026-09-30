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
  /**
   * `piwi.openInDashboard` (arguments: `[url]`), `piwi.runTests` (arguments: `[RunTestsArgs]`),
   * `piwi.openTrace` (arguments: `[TraceParams]`), `piwi.runCommand` (arguments: `[RunCommandArgs]`) or
   * `piwi.copyText` (arguments: `[text]`).
   */
  command: 'piwi.openInDashboard' | 'piwi.runTests' | 'piwi.openTrace' | 'piwi.runCommand' | 'piwi.copyText';
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

/** `piwi.runCommand`'s argument: a command line to run in a terminal. */
export interface RunCommandArgs {
  cwd: string;
  command: string;
}

export type ConnectionSource = 'environment' | 'dotenv' | 'desktop' | 'editor';

/** `piwi/status`: what the service is connected to, per workspace context. */
export interface StatusResult {
  contexts: Array<{
    /** The Playwright config's directory. */
    root: string;
    connected: boolean;
    serverUrl: string | null;
    /**
     * Where `serverUrl` came from: the environment, the workspace `.env`, the
     * editor's own settings, or the desktop app.
     */
    source: ConnectionSource | null;
    projectId: number | null;
    projectName: string | null;
    branch: string | null;
    locators: number;
    reachedFiles: number;
    /** Why it is not connected, in one sentence. */
    problem: string | null;
    /**
     * The instance the environment, the workspace `.env` or the editor's
     * settings name, in use or not: Connect offers it beside the desktop app.
     * Null when none does.
     */
    instance?: { serverUrl: string; source: ConnectionSource } | null;
  }>;
  /** The address of the desktop app running on this machine; null when it does not run. */
  desktopUrl?: string | null;
}

export const STATUS_REQUEST = 'piwi/status';

/**
 * `piwi/statusChanged` (notification, server to client): what `piwi/status`
 * answers changed, such as a connection, a project, or the desktop app starting
 * or quitting; carries `StatusResult`.
 */
export const STATUS_NOTIFICATION = 'piwi/statusChanged';

/**
 * `piwi/desktop`: the desktop app running on this machine, for Connect to offer
 * it: its address, the projects its token opens, and the one linked there to
 * the folder of the first Playwright config. `url` is null when it does not run.
 */
export interface DesktopResult {
  url: string | null;
  projects: Array<{ id: number; name: string }>;
  linked: { id: number; name: string } | null;
}

export const DESKTOP_REQUEST = 'piwi/desktop';

/** `piwi/refresh`: fetch every index again now. */
export const REFRESH_REQUEST = 'piwi/refresh';

/**
 * `piwi/setCredentials` (notification): the connection the editor's own
 * settings hold, the API key from its secret store. `serverUrl` comes after
 * the environment and the workspace `.env`, and before the desktop app; with
 * `desktop`, the desktop app comes first while it runs.
 */
export interface EditorCredentials {
  serverUrl?: string | null;
  apiKey?: string | null;
  project?: string | null;
  /**
   * Read the desktop app while it runs, before every other source: the choice
   * made with Connect, kept on this machine only. The other sources count again
   * when the app quits.
   */
  desktop?: boolean | null;
  /** The desktop app's project with `desktop`; without one, the project linked there to the folder. */
  desktopProject?: string | null;
}

export const SET_CREDENTIALS_NOTIFICATION = 'piwi/setCredentials';

/** `piwi/trace`: download an execution's trace and return the command that opens it in Playwright's trace viewer. */
export interface TraceParams {
  /** Any file of the workspace the execution belongs to, to pick the Playwright config. */
  uri: string;
  executionId: number;
}

export interface TraceResult {
  /** The downloaded trace archive. */
  path: string;
  /** The directory to run the command in: the Playwright config's, so its Playwright opens it. */
  cwd: string;
  command: string;
}

export const TRACE_REQUEST = 'piwi/trace';

/** The latest run on the checked-out branch of one workspace context. */
export interface RunStatus {
  /** The Playwright config's directory. */
  root: string;
  /** The branch whose runs are read; null reads the newest run of any branch. */
  branch: string | null;
  run: {
    id: number;
    status: string;
    /** ISO 8601. */
    startTime: string;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    flakyTests: number;
    skippedTests: number;
    /** The run's page in the dashboard. */
    url: string;
  } | null;
  /** Failed executions the Problems panel lists for this run. */
  failures: number;
}

/** `piwi/runStatus`: the latest run of each context, for the status bar. */
export interface RunStatusResult {
  contexts: RunStatus[];
}

export const RUN_STATUS_REQUEST = 'piwi/runStatus';

/** `piwi/runStatusChanged` (notification, server to client): a context's latest run changed; carries `RunStatusResult`. */
export const RUN_STATUS_NOTIFICATION = 'piwi/runStatusChanged';

/** An MCP server the editor's agent can register: Piwi's, with the connection the service already has. */
export interface McpServerDefinition {
  label: string;
  /** The streamable HTTP endpoint. */
  url: string;
  headers: Record<string, string>;
}

/** `piwi/mcp`: one definition per Piwi instance the workspace is connected to. */
export interface McpServersResult {
  servers: McpServerDefinition[];
}

export const MCP_REQUEST = 'piwi/mcp';

/** A saved test selection of the project, resolved against the catalog. */
export interface SelectionItem {
  key: string;
  name: string;
  /** Tests it selects now. */
  count: number;
  /** Whether it selects a test defined in the file asked about. */
  includesFile: boolean;
}

/** `piwi/selections`: the project's saved selections; `uri` marks those selecting a test of that file. */
export interface SelectionsParams {
  uri?: string;
}

export interface SelectionsResult {
  items: SelectionItem[];
}

export const SELECTIONS_REQUEST = 'piwi/selections';

/** `piwi/runSelection`: the command line that runs a saved selection, as `piwi run <key>` resolves it. */
export interface RunSelectionParams {
  /** Any file of the workspace, to pick the Playwright config. */
  uri: string;
  key: string;
}

export const RUN_SELECTION_REQUEST = 'piwi/runSelection';

/** A failure of the latest run, where it shows in the workspace. */
export interface WorkspaceFailure {
  /** The file the failure shows in: its failing call, else its `test(…)` line. */
  uri: string;
  /** 0-based. */
  line: number;
  title: string;
  headline: string | null;
  executionId: number;
  runId: number;
  /** The execution's page in the dashboard. */
  url: string;
  hasTrace: boolean;
}

/**
 * `piwi/failures`: the failures of each context's latest run, for a client that lists them natively (the JetBrains
 * IDEs publish diagnostics of open files only). The same failures are published as `ci-failure` diagnostics.
 */
export interface FailuresResult {
  items: WorkspaceFailure[];
}

export const FAILURES_REQUEST = 'piwi/failures';

/**
 * `piwi/renderSteps`: a flow recorded in Piwi Picker (a steps document, as `piwi codegen` reads it) rendered as the
 * body of a test, for the file at `uri`: with the project's functions and the locators its tests already use, as
 * `piwi codegen --body` renders it.
 */
export interface RenderStepsParams {
  uri: string;
  steps: unknown;
}

export interface RenderStepsResult {
  code: string;
  warnings: string[];
}

export const RENDER_STEPS_REQUEST = 'piwi/renderSteps';
