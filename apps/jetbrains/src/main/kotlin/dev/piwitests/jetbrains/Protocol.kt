package dev.piwitests.jetbrains

import org.eclipse.lsp4j.jsonrpc.services.JsonNotification
import org.eclipse.lsp4j.jsonrpc.services.JsonRequest
import org.eclipse.lsp4j.services.LanguageServer
import java.util.concurrent.CompletableFuture

/*
 * The editor service's own requests (packages/editor/src/protocol.ts), as lsp4j
 * reads them. Fields are nullable: Gson fills what the service sends.
 */

data class UriParams(val uri: String)

data class PiwiCommand(val title: String? = null, val command: String? = null, val arguments: List<Any?>? = null)

/**
 * A line of `piwi/fileSummary`. On a test's line, `status` is its latest result (`passed`, `failed`, `flaky`,
 * `skipped` or `unknown`), shown in the gutter with `title` as its tooltip, `endLine` where its call ends, and
 * `failure` where and why it failed.
 */
data class SummaryLine(
    val line: Int = 0,
    val title: String? = null,
    val command: PiwiCommand? = null,
    val status: String? = null,
    val endLine: Int? = null,
    val failure: TestFailure? = null,
)

/** The line of the test a failure went through (0-based), and why it failed. */
data class TestFailure(
    val line: Int = 0,
    val headline: String? = null,
    val message: String? = null,
    val executionId: Int = 0,
    val url: String? = null,
)

data class FileSummary(val file: SummaryLine? = null, val lines: List<SummaryLine>? = null)

data class EditorTest(
    val id: Int = 0,
    val title: String? = null,
    val file: String? = null,
    val status: String? = null,
    val url: String? = null,
)

data class TestsForFile(val tests: List<EditorTest>? = null, val basis: String? = null)

data class RunTestsArgs(val uri: String, val testIds: List<Int>)

data class RunCommandArgs(val cwd: String, val command: String, val env: Map<String, String>? = null)

data class RunCommand(
    val cwd: String? = null,
    val command: String? = null,
    val args: List<String>? = null,
    val env: Map<String, String>? = null,
)

data class TraceParams(val uri: String, val executionId: Int)

data class TraceResult(val path: String? = null, val cwd: String? = null, val command: String? = null)

data class ScreenshotResult(val path: String? = null)

data class ContextStatus(
    val root: String? = null,
    val connected: Boolean = false,
    val serverUrl: String? = null,
    /** `environment`, `dotenv`, `desktop` or `editor`: where `serverUrl` came from. */
    val source: String? = null,
    val projectId: Int? = null,
    val projectName: String? = null,
    val branch: String? = null,
    val locators: Int = 0,
    val reachedFiles: Int = 0,
    val problem: String? = null,
    /** The instance the environment, the `.env` or the settings name, in use or not; Connect offers it beside the desktop app. */
    val instance: NamedInstance? = null,
)

data class NamedInstance(val serverUrl: String? = null, val source: String? = null)

/** `piwi/status`; `desktopUrl` is the desktop app running on this machine, null when it does not run. */
data class StatusResult(val contexts: List<ContextStatus>? = null, val desktopUrl: String? = null)

data class RunInfo(
    val id: Int = 0,
    val status: String? = null,
    val startTime: String? = null,
    val totalTests: Int = 0,
    val passedTests: Int = 0,
    val failedTests: Int = 0,
    val flakyTests: Int = 0,
    val skippedTests: Int = 0,
    val url: String? = null,
)

/** The latest run a context reads; `checkedOut` differs from `branch` while the checked-out branch has no run. */
data class RunStatus(
    val root: String? = null,
    val branch: String? = null,
    val run: RunInfo? = null,
    val failures: Int = 0,
    val checkedOut: String? = null,
)

data class RunStatusResult(val contexts: List<RunStatus>? = null)

data class WorkspaceFailure(
    val uri: String? = null,
    val line: Int = 0,
    val title: String? = null,
    val headline: String? = null,
    val executionId: Int = 0,
    val runId: Int = 0,
    val url: String? = null,
    val hasTrace: Boolean = false,
)

data class FailuresResult(val items: List<WorkspaceFailure>? = null)

data class McpServerDefinition(val label: String? = null, val url: String? = null, val headers: Map<String, String>? = null)

data class McpServersResult(val servers: List<McpServerDefinition>? = null)

data class RenderStepsParams(val uri: String, val steps: Any?)

data class RenderStepsResult(val code: String? = null, val warnings: List<String>? = null)

data class SelectionsParams(val uri: String?)

data class SelectionItem(val key: String = "", val name: String? = null, val count: Int = 0, val includesFile: Boolean = false)

data class SelectionsResult(val items: List<SelectionItem>? = null)

data class RunSelectionParams(val uri: String, val key: String)

data class ProjectRef(val id: Int = 0, val name: String = "")

/** `piwi/desktop`: the desktop app running on this machine; `url` is null when it does not run. */
data class DesktopResult(val url: String? = null, val projects: List<ProjectRef>? = null, val linked: ProjectRef? = null)

/**
 * `piwi/setCredentials`: the instance saved in the IDE, and, with `desktop`, the desktop app first while it runs,
 * on the project `desktopProject` names, else the one linked there to the folder.
 */
data class EditorCredentials(
    val serverUrl: String? = null,
    val apiKey: String? = null,
    val project: String? = null,
    val desktop: Boolean = false,
    val desktopProject: String? = null,
)

/**
 * `piwi/desktopJob`, and the arguments of the client command `piwi.desktopJob`: ask the desktop app to reproduce
 * (`kind` `reproduce`) or bisect (`bisect`) a failure of the instance the context at `root` reads.
 */
data class DesktopJobParams(val root: String = "", val executionId: Int = 0, val kind: String = "reproduce")

data class DesktopJobResult(val ok: Boolean = false, val message: String? = null, val jobId: String? = null)

data class DesktopJobShare(val label: String? = null)

/**
 * `piwi/desktopJobChanged`: a job's `status` (`running`, `done`, `declined`, `expired`, `gone`), the sentence to
 * show, and `share` when its verdict can be shared on the instance (`piwi/shareDesktopJob`).
 */
data class DesktopJobUpdate(
    val jobId: String? = null,
    val kind: String? = null,
    val status: String? = null,
    val message: String? = null,
    val share: DesktopJobShare? = null,
)

data class ShareDesktopJobParams(val jobId: String)

data class ShareDesktopJobResult(val ok: Boolean = false, val message: String? = null, val url: String? = null)

/** The service's custom requests beside the language server protocol. */
interface PiwiLanguageServer : LanguageServer {
    @JsonRequest("piwi/fileSummary")
    fun fileSummary(params: UriParams): CompletableFuture<FileSummary?>

    @JsonRequest("piwi/testsForFile")
    fun testsForFile(params: UriParams): CompletableFuture<TestsForFile?>

    @JsonRequest("piwi/runArgs")
    fun runArgs(params: RunTestsArgs): CompletableFuture<RunCommand?>

    @JsonRequest("piwi/status")
    fun status(): CompletableFuture<StatusResult?>

    @JsonRequest("piwi/runStatus")
    fun runStatus(): CompletableFuture<RunStatusResult?>

    @JsonRequest("piwi/failures")
    fun failures(): CompletableFuture<FailuresResult?>

    @JsonRequest("piwi/trace")
    fun trace(params: TraceParams): CompletableFuture<TraceResult?>

    @JsonRequest("piwi/screenshot")
    fun screenshot(params: TraceParams): CompletableFuture<ScreenshotResult?>

    @JsonRequest("piwi/mcp")
    fun mcp(): CompletableFuture<McpServersResult?>

    @JsonRequest("piwi/renderSteps")
    fun renderSteps(params: RenderStepsParams): CompletableFuture<RenderStepsResult?>

    @JsonRequest("piwi/selections")
    fun selections(params: SelectionsParams): CompletableFuture<SelectionsResult?>

    @JsonRequest("piwi/runSelection")
    fun runSelection(params: RunSelectionParams): CompletableFuture<RunCommand?>

    @JsonRequest("piwi/desktop")
    fun desktop(): CompletableFuture<DesktopResult?>

    @JsonRequest("piwi/refresh")
    fun refresh(): CompletableFuture<Any?>

    @JsonRequest("piwi/desktopJob")
    fun desktopJob(params: DesktopJobParams): CompletableFuture<DesktopJobResult?>

    @JsonRequest("piwi/shareDesktopJob")
    fun shareDesktopJob(params: ShareDesktopJobParams): CompletableFuture<ShareDesktopJobResult?>

    @JsonNotification("piwi/setCredentials")
    fun setCredentials(params: EditorCredentials)
}
