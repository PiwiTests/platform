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
   * `piwi.openTrace` (arguments: `[TraceParams]`), `piwi.openScreenshot` (arguments: `[ScreenshotParams]`),
   * `piwi.runCommand` (arguments: `[RunCommandArgs]`), `piwi.copyText` (arguments: `[text]`) or
   * `piwi.desktopJob` (arguments: `[DesktopJobParams]`).
   */
  command:
    | 'piwi.openInDashboard'
    | 'piwi.runTests'
    | 'piwi.openTrace'
    | 'piwi.openScreenshot'
    | 'piwi.runCommand'
    | 'piwi.copyText'
    | 'piwi.desktopJob';
  arguments: unknown[];
}

/** One line of text shown above a line of a file. */
export interface SummaryLine {
  /** 0-based line the text sits above. */
  line: number;
  title: string;
  command?: PiwiCommand;
  /**
   * On a test's line: its latest result, which the clients show in the gutter, with `title`
   * as its tooltip, rather than as text above the line. Absent on other lines.
   */
  status?: TestLineStatus;
  /** On a test's line: the 0-based line its `test(…)` call ends on, for the background of a failing test. */
  endLine?: number;
  /** On the line of a test that failed in the latest run the service reads: where and why. */
  failure?: TestFailure;
}

/** A test's latest result: `failed` when it failed in the latest run the service reads. */
export type TestLineStatus = 'passed' | 'failed' | 'flaky' | 'skipped' | 'unknown';

/**
 * Where and why a test failed. The lines above `line` (the reason, the screenshot, the trace) are
 * ordinary summary lines.
 */
export interface TestFailure {
  /**
   * 0-based line of this file the failure went through, followed through the edits since the run: the innermost
   * frame of the error's stack within the test, else within this file, else the `test(…)` line.
   */
  line: number;
  /** One line on why it failed. */
  headline: string | null;
  /** The error without its stack trace, shortened; null when the instance does not send it. */
  message: string | null;
  executionId: number;
  /** The execution's page in the dashboard. */
  url: string;
  /**
   * `edited` once the line the run failed at changed since (the test stays `failed` until a run covers it),
   * `failing` otherwise. Absent from an older service.
   */
  state?: 'failing' | 'edited';
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
  /** Environment variables to set on the command's process. */
  env?: Record<string, string>;
  /**
   * The ref the run carries (`PIWI_ORIGIN_REF` in `env`), by which the service finds and follows it: the client
   * names it in `piwi/commandEnded` once the command ends. Absent from an older service.
   */
  ref?: string;
}

export const RUN_ARGS_REQUEST = 'piwi/runArgs';

/** `piwi.runCommand`'s argument: a command line to run in a terminal. */
export interface RunCommandArgs {
  cwd: string;
  command: string;
  /** Environment variables to set on the command's process. */
  env?: Record<string, string>;
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
 * `piwi/refreshRun`: read each context's latest run, its failures and the run in progress again now, not the indexes
 * `piwi/refresh` fetches; answers `RunStatusResult`.
 */
export const REFRESH_RUN_REQUEST = 'piwi/refreshRun';

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

/** `piwi/screenshot`: download an execution's failure screenshot and return where it is, for the editor to open. */
export type ScreenshotParams = TraceParams;

export interface ScreenshotResult {
  path: string;
}

export const SCREENSHOT_REQUEST = 'piwi/screenshot';

/**
 * The latest run on the checked-out branch of one workspace context: its latest complete run, and the later runs of
 * that branch the service lays over it (a test re-run from an editor, a run on a developer's machine).
 */
export interface RunStatus {
  /** The Playwright config's directory. */
  root: string;
  /** The branch whose runs are read; null reads the newest run of any branch. */
  branch: string | null;
  /**
   * The branch checked out in the workspace. When it has no run yet, `branch` is the
   * project's default branch, or null for the newest run of any branch.
   */
  checkedOut?: string | null;
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
  /** Failed executions the Problems panel lists for this run, as the runs laid over it leave them. */
  failures: number;
  /** The tests among those failures: a test failing on several Playwright projects counts once. */
  failingTests?: number;
  /** The tests that failed in `run` and passed since in a run laid over it, on every project they failed on. */
  resolved?: number;
  /** The runs of the branch since `run` that the service lays over it. */
  overlays?: number;
  /**
   * The run in progress the context follows: the editor's own (`own`), wherever it runs, else one on `branch` or the
   * checked-out branch. Null while none runs; it goes back to null in the notification that carries the failures read
   * once it ended.
   */
  live?: LiveRun | null;
  /**
   * `live` while the instance's event stream is connected: the service learns that a run ended within a second, and
   * reads the latest run every five minutes besides; `polling` otherwise, every minute.
   */
  stream?: 'live' | 'polling';
  /** When the latest run was last read (ISO 8601); absent before the first read. */
  updatedAt?: string;
}

/** A run in progress, as its events count it. */
export interface LiveRun {
  runId: number;
  /** `running`, `initializing` or `finalizing`. */
  status: string;
  /** The tests that ended (passed, failed, flaky, skipped or not run) out of `total`. */
  done: number;
  total: number;
  failed: number;
  /** ISO 8601. */
  startedAt: string;
  /** Whether the editor started it: a command of `piwi/runArgs` or `piwi/runSelection`. */
  own: boolean;
}

/** `piwi/runStatus`: the latest run of each context, for the status bar. */
export interface RunStatusResult {
  contexts: RunStatus[];
}

export const RUN_STATUS_REQUEST = 'piwi/runStatus';

/** `piwi/runStatusChanged` (notification, server to client): a context's latest run changed; carries `RunStatusResult`. */
export const RUN_STATUS_NOTIFICATION = 'piwi/runStatusChanged';

/**
 * `piwi/commandStarted` (notification, client to server): the client sent the command of a `RunCommand` built with
 * `ref` to a terminal. `terminalRef` is the ref of that terminal's environment when it is another one, which the run
 * carries instead: the service does not look for `ref`, and recognizes the run by `terminalRef`.
 */
export interface CommandStartedParams {
  ref: string;
  terminalRef?: string;
}

export const COMMAND_STARTED_NOTIFICATION = 'piwi/commandStarted';

/**
 * `piwi/commandEnded` (notification, client to server): the command of a `RunCommand` with a `ref` ended, with its exit
 * code when the client knows it. The service reads the run once more, and says in `piwi/notice` when no run carries
 * the ref.
 */
export interface CommandEndedParams {
  ref: string;
  exitCode: number | null;
}

export const COMMAND_ENDED_NOTIFICATION = 'piwi/commandEnded';

/** `piwi/notice` (notification, server to client): a sentence for the client to show once, about the context at `root`. */
export interface Notice {
  root: string;
  severity: 'information' | 'warning';
  message: string;
}

export const NOTICE_NOTIFICATION = 'piwi/notice';

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

/**
 * A failure of the latest run, where it shows in the workspace, or a failure of that run that a later run passed
 * (`state: 'fixed-locally'`), at its `test(…)` line.
 */
export interface WorkspaceFailure {
  /** The file the failure shows in: its failing call, else its `test(…)` line. */
  uri: string;
  /** 0-based, followed through the edits since the run. */
  line: number;
  title: string;
  /** Null for a failure fixed since. */
  headline: string | null;
  /** The execution that failed, or for a failure fixed since, the execution that passed. */
  executionId: number;
  /** The run of `executionId`. */
  runId: number;
  /** The execution's page in the dashboard. */
  url: string;
  hasTrace: boolean;
  /**
   * `ci` when `runId` is a CI run, `own` when this editor started it, `local` when it ran elsewhere on a developer's
   * machine, in the desktop app or an editor.
   */
  source?: 'ci' | 'local' | 'own';
  /**
   * `failing`; `edited` once the line the run failed at changed since; `fixed-locally` when a run laid over the
   * latest complete run passed the test since.
   */
  state?: 'failing' | 'edited' | 'fixed-locally';
  /** The Playwright project; null when unknown. */
  browserName?: string | null;
}

/**
 * `piwi/failures`: the failures of each context's latest run, for a client that lists them natively (the JetBrains
 * IDEs publish diagnostics of open files only). The same failures are published as `ci-failure` diagnostics, an
 * `edited` one as an information; a failure whose test's `test(…)` call left its spec is in neither. The failures a
 * later run fixed (`fixed-locally`) follow them and publish none.
 */
export interface FailuresResult {
  items: WorkspaceFailure[];
}

export const FAILURES_REQUEST = 'piwi/failures';

/**
 * `piwi/failuresChanged` (notification, server to client): what `piwi/failures` answers changed, such as a failure's
 * line or state after an edit, or the failures of a run read again; carries `FailuresResult`.
 */
export const FAILURES_NOTIFICATION = 'piwi/failuresChanged';

/**
 * `piwi/renderSteps`: a flow recorded in Piwi Picker (a steps document, as `piwi codegen` reads it) rendered as the
 * body of a test, for the file at `uri`: with the project's functions and the locators its tests already use, as
 * `piwi codegen --body` renders it.
 */
export interface RenderStepsParams {
  uri: string;
  steps: unknown;
  /**
   * 0-based caret position: the steps run on the page expression in use there (`piwi/pageCandidates`'s default), and
   * a page object already declared there before the caret is not instantiated again.
   */
  line?: number | null;
  character?: number | null;
  /**
   * `separate`: the import lines the code needs come in `imports`, for the client to add at the top of the file,
   * instead of as `// Needs: import …` comments in `code`.
   */
  imports?: 'comments' | 'separate' | null;
}

export interface RenderStepsResult {
  code: string;
  warnings: string[];
  /**
   * With `imports: 'separate'`: the import lines the code needs whose names the file's import statements do not bind
   * yet, as of the file's text the service holds. The client adds those it does not hold already.
   */
  imports?: string[];
}

export const RENDER_STEPS_REQUEST = 'piwi/renderSteps';

/**
 * Where a recording writes: `steps`, lines of the test, method or function the caret is in; `test`, a new `test(…)`
 * at the caret; `file`, a whole new spec.
 */
export type RecordInto = 'steps' | 'test' | 'file';

/**
 * `piwi/record`: open a browser through the Playwright of the file's config, with the `use` options of one of its
 * projects, and write the steps recorded there into the file, at the caret, until `piwi/stopRecording`. What is
 * written comes in `piwi/recordingChanged` notifications. A caret that does not fit `into` is refused with `ok: false`
 * and a sentence: `steps` needs the `test` or `function` context of `piwi/pageCandidates`, `test` needs `file`;
 * `file` is not checked.
 */
export interface RecordParams {
  uri: string;
  /** 0-based caret position: where the recorded block starts. */
  line: number;
  character: number;
  into: RecordInto;
  /** The Playwright project whose `use` options the browser gets; the config's only project when absent. */
  project?: string | null;
  /** A path on the project's `baseURL`, or an absolute URL; the `baseURL` when absent. */
  startUrl?: string | null;
  /** The test's title, for `test` and `file`. */
  title?: string | null;
  /** The page expression the steps run on; `piwi/pageCandidates`'s default when absent. */
  page?: string | null;
  /** The editor's display language, a BCP 47 tag such as `fr` or `pt-BR`, for the recorder's panel in the browser. */
  language?: string | null;
}

/**
 * Where the recorded block goes, decided from the file's text when the recording starts. The client writes the block
 * there on the first `piwi/recordingChanged`, then follows it through the edits around it.
 */
export interface RecordingPlacement {
  /** 0-based line the block's first line goes on. */
  line: number;
  /**
   * Whether that line is new: the client first inserts an empty line there, pushing the line that was there down.
   * Otherwise the line is empty (or blank) and the block takes its place.
   */
  newLine: boolean;
  /** What every line of the block starts with; an empty line of the block stays empty. */
  indent: string;
}

export interface RecordResult {
  ok: boolean;
  sessionId?: string;
  /** One sentence for the client to show when the recording did not start. */
  message: string;
  /** When the config has several projects and none was given: their names, for the client to ask which. */
  projects?: string[];
  /** Where the block goes; set when `ok`. For `file`, line 0 of the (empty) file, with no indent. */
  placement?: RecordingPlacement;
}

export const RECORD_REQUEST = 'piwi/record';

/** `piwi/stopRecording`: stop recording; the browser closes and a last `piwi/recordingChanged` says `stopped`. */
export interface StopRecordingParams {
  sessionId: string;
}

export const STOP_RECORDING_REQUEST = 'piwi/stopRecording';

/**
 * `piwi/recordingCommand`: `pause` stops writing what is done in the browser; `resume` writes again, and the service
 * sends the latest `piwi/recordingChanged` again, which rewrites the recorded block.
 */
export interface RecordingCommandParams {
  sessionId: string;
  command: 'pause' | 'resume';
}

export const RECORDING_COMMAND_REQUEST = 'piwi/recordingCommand';

/** A recorded step, as the recorded block holds it. */
export interface RecordingStep {
  /** The step in words, as the extension's review lists it. */
  words: string;
  /** 0-based line of `RecordingUpdate.code` the step starts on; the steps a function call stands for share it. */
  line: number;
  /** The locators the recorder verified for the step's element, best first; empty for a step without an element. */
  locators: string[];
  /** The index in `locators` of the one written; null when none could be written. */
  chosen: number | null;
  /** The project function the step is part of, when a catalog call stands for it. */
  functionName?: string | null;
}

/** Something about a recorded step the reader of the code should check: a brittle locator, a secret, a file. */
export interface RecordingWarning {
  /** Index of the step in `RecordingUpdate.steps`. */
  step: number;
  /** 0-based line of `RecordingUpdate.code` the warning is about. */
  line: number;
  message: string;
}

/**
 * `piwi/recordingChanged` (notification, server to client): what the recorded block holds now, and the session's
 * state. `code` is the whole block: lines joined with `\n`, no trailing newline, not indented; the client prefixes
 * every non-empty line with `RecordResult.placement.indent`.
 */
export interface RecordingUpdate {
  sessionId: string;
  /** The file the session writes into. */
  uri: string;
  into: RecordInto;
  state: 'starting' | 'recording' | 'paused' | 'stopped' | 'failed';
  code: string;
  /**
   * Import lines the code needs (a catalog call's page object or helper) whose names the file's import statements do
   * not bind yet, as of the file's text when the block was rendered; the client adds those it does not hold already.
   * Empty for `into: 'file'`, whose `code` holds its imports.
   */
  imports: string[];
  steps: RecordingStep[];
  warnings: RecordingWarning[];
  /** One sentence on what happened: why the session failed, or what the client should know. */
  message?: string | null;
  /** An action the client offers with `message`, such as installing the browser (`piwi.runCommand`). */
  command?: PiwiCommand | null;
}

export const RECORDING_NOTIFICATION = 'piwi/recordingChanged';

/** `piwi/pageCandidates`: the page expressions the steps written at a position could run on. */
export interface PageCandidatesParams {
  uri: string;
  line: number;
  character: number;
}

export interface PageCandidate {
  expression: string;
  /** Why it is offered, in a few words: `used on line 12`, `fixture of this test`, `field of SignInPage`. */
  reason: string;
}

export interface PageCandidatesResult {
  /** Best first; the default is always among them. */
  candidates: PageCandidate[];
  default: string;
  /**
   * Where the position is: `test`, in the body of a test's or a hook's callback; `function`, in the body of another
   * function or method (a page object's method, a helper), even inside a class; `class`, in a class body between its
   * members; `file`, anywhere else (the top level, a `test.describe` callback between its tests). `file` takes a new
   * test (`into: 'test'`); `test` and `function` take steps (`into: 'steps'`); `class` takes neither.
   */
  context: 'test' | 'function' | 'class' | 'file';
}

export const PAGE_CANDIDATES_REQUEST = 'piwi/pageCandidates';

/**
 * What the desktop app is asked to do with a failure or a flaky test from the team instance: reproduce the failure,
 * bisect it, or run the test's Flake Lab experiment.
 */
export type DesktopJobKind = 'reproduce' | 'bisect' | 'flake-lab';

/**
 * `piwi/desktopJob`, and the arguments of the client command `piwi.desktopJob` that sends it: ask the desktop app
 * running on this machine to reproduce a failure of the instance the context reads (`root`), at its commit, to
 * bisect it, or to run Flake Lab on a test (`flake-lab`, with `testCaseId`; `executionId` names the failure it was
 * offered on, if any). The app shows the job in its window and runs nothing until the developer starts it there.
 */
export interface DesktopJobParams {
  root: string;
  /** The failure, for `reproduce` and `bisect`. */
  executionId?: number | null;
  /** The test, for `flake-lab`. */
  testCaseId?: number | null;
  kind: DesktopJobKind;
}

export interface DesktopJobResult {
  ok: boolean;
  /** One sentence for the client to show: where to confirm the job, or why it was not sent. */
  message: string;
  jobId?: string;
}

export const DESKTOP_JOB_REQUEST = 'piwi/desktopJob';

/**
 * `piwi/desktopJobChanged`, sent while the service follows a job: the developer started it in the desktop app
 * (`running`), it ended (`done`, with the verdict in `message`), or it was `declined`, `expired`, or the app quit
 * (`gone`). `share` names the instance the verdict can be shared on (`piwi/shareDesktopJob`): a bisect's first bad
 * commit, or the results of a Flake Lab run; null when there is nothing to share.
 */
export interface DesktopJobUpdate {
  jobId: string;
  kind: DesktopJobKind;
  status: 'running' | 'done' | 'declined' | 'expired' | 'gone';
  message: string;
  share: { label: string } | null;
}

export const DESKTOP_JOB_NOTIFICATION = 'piwi/desktopJobChanged';

/** `piwi/shareDesktopJob`: record a job's verdict on the instance the job came from, with the editor's key. */
export interface ShareDesktopJobParams {
  jobId: string;
}

export interface ShareDesktopJobResult {
  ok: boolean;
  message: string;
  /** The failure cluster's page, or the test's Flakiness tab, once shared. */
  url?: string;
}

export const SHARE_DESKTOP_JOB_REQUEST = 'piwi/shareDesktopJob';
