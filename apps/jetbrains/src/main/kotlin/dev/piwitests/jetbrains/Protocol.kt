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

data class SummaryLine(val line: Int = 0, val title: String? = null, val command: PiwiCommand? = null)

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

data class RunCommand(val cwd: String? = null, val command: String? = null, val args: List<String>? = null)

data class TraceParams(val uri: String, val executionId: Int)

data class TraceResult(val path: String? = null, val cwd: String? = null, val command: String? = null)

data class ContextStatus(
    val root: String? = null,
    val connected: Boolean = false,
    val serverUrl: String? = null,
    val projectId: Int? = null,
    val projectName: String? = null,
    val branch: String? = null,
    val locators: Int = 0,
    val reachedFiles: Int = 0,
    val problem: String? = null,
)

data class StatusResult(val contexts: List<ContextStatus>? = null)

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

data class RunStatus(val root: String? = null, val branch: String? = null, val run: RunInfo? = null, val failures: Int = 0)

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

data class EditorCredentials(val serverUrl: String? = null, val apiKey: String? = null, val project: String? = null)

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

    @JsonRequest("piwi/mcp")
    fun mcp(): CompletableFuture<McpServersResult?>

    @JsonRequest("piwi/renderSteps")
    fun renderSteps(params: RenderStepsParams): CompletableFuture<RenderStepsResult?>

    @JsonRequest("piwi/refresh")
    fun refresh(): CompletableFuture<Any?>

    @JsonNotification("piwi/setCredentials")
    fun setCredentials(params: EditorCredentials)
}
