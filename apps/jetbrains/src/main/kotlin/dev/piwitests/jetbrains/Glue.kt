package dev.piwitests.jetbrains

import com.google.gson.JsonArray
import com.google.gson.JsonObject
import com.google.gson.JsonParser
import java.io.IOException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes

/**
 * What the plugin shows, computed from the editor service's answers, where it
 * looks for Playwright configs, and where a recording's lines go, with no
 * platform API, so it is tested without an IDE.
 */
object Glue {
    /** The files the editor service reads: test and application code, translations, and Razor views. */
    val SUPPORTED_EXTENSIONS = setOf(
        "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts", "vue", "svelte", "astro", "html",
        "json", "yaml", "yml", "properties", "po", "resx", "cshtml", "razor",
    )

    val PLAYWRIGHT_CONFIGS = listOf(
        "playwright.config.ts", "playwright.config.js", "playwright.config.mjs", "playwright.config.cjs",
    )

    /** Directory levels searched below a folder for Playwright configs, as the editor service does. */
    const val CONFIG_DEPTH = 4

    /** Folders never searched for a Playwright config, beside the hidden ones. */
    private val SKIPPED_DIRS = setOf("node_modules", "dist", "build", "coverage", "test-results")

    /** Where a project's Playwright configs are: the folders searched, and those holding a config. */
    data class PlaywrightSearch(val roots: List<Path>, val configDirs: List<Path>)

    /**
     * The folder holding a project's files, from the IDE's project path: Rider keeps a solution's
     * project in `<solution folder>/.idea/.idea.<name>`, so it is the folder above `.idea`.
     */
    fun projectFolder(basePath: String): String {
        val path = basePath.replace('\\', '/').trimEnd('/')
        val idea = Regex("/\\.idea(/|$)").find(path) ?: return path
        return path.substring(0, idea.range.first).ifEmpty { "/" }
    }

    /** The folders, each once, without those inside another one. */
    fun outermost(folders: List<Path>): List<Path> {
        val all = folders.map { it.toAbsolutePath().normalize() }.distinct()
        return all.filter { folder -> all.none { it != folder && folder.startsWith(it) } }
    }

    /**
     * The folders under `roots`, the roots included and down to [CONFIG_DEPTH] levels, that hold a
     * Playwright config. Dependencies, build output and hidden folders are skipped, as the editor
     * service skips them.
     */
    fun playwrightConfigDirs(roots: List<Path>): List<Path> {
        val found = LinkedHashSet<Path>()
        for (root in roots) {
            if (!Files.isDirectory(root)) continue
            Files.walkFileTree(root, emptySet(), CONFIG_DEPTH + 1, object : SimpleFileVisitor<Path>() {
                override fun preVisitDirectory(dir: Path, attrs: BasicFileAttributes): FileVisitResult {
                    val name = dir.fileName?.toString() ?: return FileVisitResult.CONTINUE
                    val skipped = dir != root && (name.startsWith(".") || name in SKIPPED_DIRS)
                    return if (skipped) FileVisitResult.SKIP_SUBTREE else FileVisitResult.CONTINUE
                }

                override fun visitFile(file: Path, attrs: BasicFileAttributes): FileVisitResult {
                    if (attrs.isRegularFile && file.fileName.toString() in PLAYWRIGHT_CONFIGS) file.parent?.let { found.add(it) }
                    return FileVisitResult.CONTINUE
                }

                override fun visitFileFailed(file: Path, exc: IOException): FileVisitResult = FileVisitResult.CONTINUE
            })
        }
        return found.sorted()
    }

    /** The repository around `dir`: the nearest folder, `dir` included, that holds `.git`; null outside one. */
    fun repositoryRoot(dir: Path): Path? =
        generateSequence(dir.toAbsolutePath().normalize()) { it.parent }.firstOrNull { Files.exists(it.resolve(".git")) }

    /**
     * The Playwright configs of a project whose files are in `folders` (those on disk). When they
     * hold none, the repository around them is searched: a Rider solution in a subfolder, beside
     * the tests. A repository in the home folder or at a drive's root is not: it holds other projects.
     */
    fun findPlaywright(folders: List<Path>, home: Path?): PlaywrightSearch {
        val roots = outermost(folders.filter { Files.isDirectory(it) })
        val dirs = playwrightConfigDirs(roots)
        if (dirs.isNotEmpty()) return PlaywrightSearch(roots, dirs)
        val homeFolder = home?.toAbsolutePath()?.normalize()
        val repositories = outermost(roots.mapNotNull { repositoryRoot(it) }.filter { it != homeFolder && it.parent != null })
        if (repositories.isEmpty() || repositories == roots) return PlaywrightSearch(roots, dirs)
        val inRepositories = playwrightConfigDirs(repositories)
        return if (inRepositories.isEmpty()) PlaywrightSearch(roots, dirs) else PlaywrightSearch(repositories, inRepositories)
    }

    private val ACTIVE = setOf("running", "initializing", "finalizing")

    /** What a click on the status bar item does: `REFRESH` reads the latest run again (`piwi/refreshRun`). */
    enum class StatusAction { REFRESH, CONNECT, SETTINGS, NONE }

    data class StatusView(val text: String, val tooltip: String, val url: String?, val action: StatusAction)

    private fun plural(n: Int, one: String, many: String = "${one}s") = "$n ${if (n == 1) one else many}"

    /** A run in progress in the status bar: `Piwi: 4/9 · 1 failing`, and ` · your run` for the editor's own. */
    private fun liveText(live: LiveRun): String {
        val failing = if (live.failed > 0) " · ${live.failed} failing" else ""
        return "Piwi: ${live.done}/${live.total}$failing" + if (live.own) " · your run" else ""
    }

    /** The tooltip's line on a run in progress: `Your run #124 is running: 4/9 · 1 failing`. */
    private fun liveLine(live: LiveRun): String {
        val failing = if (live.failed > 0) " · ${live.failed} failing" else ""
        return "\n${if (live.own) "Your run" else "Run"} #${live.runId} is running: ${live.done}/${live.total}$failing"
    }

    /** The status bar text while a click reads the latest run again. */
    const val REFRESHING = "Piwi: refreshing…"

    /**
     * How long before `now` (ms since the epoch) an ISO 8601 time is: `12 s ago`, `4 min ago`, `2 h ago`, `3 d ago`,
     * or `just now`.
     */
    fun relativeTime(iso: String, now: Long): String {
        val at = runCatching { java.time.Instant.parse(iso).toEpochMilli() }.getOrNull() ?: return "just now"
        val seconds = (now - at) / 1000
        return when {
            seconds < 1 -> "just now"
            seconds < 60 -> "$seconds s ago"
            seconds < 3_600 -> "${seconds / 60} min ago"
            seconds < 86_400 -> "${seconds / 3_600} h ago"
            else -> "${seconds / 86_400} d ago"
        }
    }

    /** The tooltip's line on when the latest run was read, and how the next one comes: `Updated 12 s ago · live`. */
    private fun updatedLine(run: RunStatus?, now: Long): String {
        val at = run?.updatedAt ?: return ""
        val how = when (run.stream) {
            "live" -> " · live"
            "polling" -> " · read every minute"
            else -> ""
        }
        return "\nUpdated ${relativeTime(at, now)}$how"
    }

    /**
     * The status bar text: the latest run on the checked-out branch, with what the runs laid over it fixed or still
     * fail, or what keeps the service from reading it. While a run is in progress, the editor's own or one on the
     * branch, the text counts it, and the tooltip has both, with when the latest run was read. A click reads it again.
     * A null status means the service has not started: it starts with the first file of the project opened.
     */
    fun statusView(
        status: StatusResult?,
        runs: RunStatusResult?,
        desktopChosen: Boolean = false,
        now: Long = System.currentTimeMillis(),
    ): StatusView {
        if (status == null) return StatusView("Piwi", "$NOT_STARTED Click for Piwi's settings.", null, StatusAction.SETTINGS)
        val contexts = status.contexts.orEmpty()
        if (contexts.isEmpty()) return StatusView("Piwi", "No Playwright config found", null, StatusAction.NONE)
        val hint = desktopHint(status, desktopChosen).let { if (it.isEmpty()) "" else "\n$it" }
        val connected = contexts.firstOrNull { it.connected }
            ?: return StatusView("Piwi: connect", (contexts.first().problem ?: "Not connected") + hint, null, StatusAction.CONNECT)
        val run = runs?.contexts?.firstOrNull { it.root == connected.root } ?: runs?.contexts?.firstOrNull()
        val where = (connected.projectName ?: "Piwi") + (run?.branch?.let { " on $it" } ?: "") + (if (run?.run != null) fallbackNote(run) else "")
        val from = (connected.serverUrl?.let { url -> "\n$url, from ${sourceLabel(connected.source)}" } ?: "") + hint
        val live = run?.live
        val progress = (live?.let { liveLine(it) } ?: "") + updatedLine(run, now)
        val r = run?.run ?: return StatusView(
            live?.let { liveText(it) } ?: "Piwi: no run",
            "No run of $where yet$progress$from",
            null,
            StatusAction.REFRESH,
        )
        // The tests still failing once the later runs are laid over the run; the run's own count from an older service.
        val failing = run.failingTests ?: r.failedTests
        val fixed = run.resolved ?: 0
        val overlays = run.overlays ?: 0
        val local = if (overlays > 0) "\n${plural(overlays, "local run")} since · ${plural(fixed, "test")} fixed locally" else ""
        val tooltip = "Run #${r.id} of $where: ${r.passedTests} passed, ${r.failedTests} failed, " +
            "${r.flakyTests} flaky, ${r.skippedTests} skipped$local$progress$from"
        val flaky = if (r.flakyTests > 0) " · ${r.flakyTests} flaky" else ""
        val refresh = StatusAction.REFRESH
        return when {
            live != null -> StatusView(liveText(live), tooltip, r.url, refresh)
            r.status in ACTIVE -> {
                val done = r.passedTests + r.failedTests + r.flakyTests + r.skippedTests
                val failed = if (r.failedTests > 0) " · ${r.failedTests} failing" else ""
                StatusView("Piwi: $done/${r.totalTests}$failed", tooltip, r.url, refresh)
            }
            failing > 0 -> {
                val fixedText = if (fixed > 0) " · $fixed fixed locally" else ""
                StatusView("Piwi: $failing failing$fixedText$flaky", tooltip, r.url, refresh)
            }
            r.status != "passed" && r.status != "failed" -> StatusView("Piwi: ${r.status}", tooltip, r.url, refresh)
            fixed > 0 -> StatusView("Piwi: $fixed fixed locally", tooltip, r.url, refresh)
            else -> StatusView("Piwi: ${r.passedTests} passed$flaky", tooltip, r.url, refresh)
        }
    }

    const val NOT_STARTED = "Piwi starts when you open a file of this project."

    /** Whether a `piwi/failures` item is a failure of the latest run that a later run passed. */
    fun isFixedLocally(failure: WorkspaceFailure) = failure.state == "fixed-locally"

    /** Whether a `piwi/failures` item is a failure whose line changed since its run. */
    fun isEdited(failure: WorkspaceFailure) = failure.state == "edited"

    /**
     * What a `piwi/failures` item says about its run, beside its title: `fixed locally in run #124` for a failure a
     * later run passed (`fixed in run #124` when that run is a CI run, `fixed locally in your run #124` when the editor
     * started it), `edited since run #120` for a failure whose line changed since its run (`edited since your run
     * #124`, `edited since local run #124`), `your run #124` for a failure of a run the editor started, `local run
     * #124` for a failure of another run that did not run in CI; null otherwise, and from an older service.
     */
    fun failureRunNote(failure: WorkspaceFailure): String? {
        val run = when (failure.source) {
            "own" -> "your run #${failure.runId}"
            "local" -> "local run #${failure.runId}"
            else -> null
        }
        return when {
            isFixedLocally(failure) -> when (failure.source) {
                "ci" -> "fixed in run #${failure.runId}"
                "own" -> "fixed locally in your run #${failure.runId}"
                else -> "fixed locally in run #${failure.runId}"
            }
            isEdited(failure) -> "edited since ${run ?: "run #${failure.runId}"}"
            else -> run
        }
    }

    /**
     * The runs as the files show them: without the run in progress, the stream and the time of the last read, which
     * move while the latest run and its failures stay. The files are drawn again when it changes.
     */
    fun runsInFiles(runs: RunStatusResult?): RunStatusResult? =
        runs?.copy(contexts = runs.contexts?.map { it.copy(live = null, stream = null, updatedAt = null) })

    /** When the checked-out branch has no run yet and another branch's is shown: which one, and why. */
    fun fallbackNote(run: RunStatus?): String {
        val checkedOut = run?.checkedOut ?: return ""
        if (run.branch == checkedOut) return ""
        return " ($checkedOut has no run yet)"
    }

    /** A test's gutter tooltip: its latest result, then its history as the service sums it up. */
    fun testResultTooltip(status: String?, title: String?): String {
        val result = when (status) {
            "failed" -> "failing"
            "flaky" -> "flaky"
            "passed" -> "passing"
            "skipped" -> "skipped"
            else -> "no recent result"
        }
        return listOfNotNull("Piwi: $result", title?.ifBlank { null }).joinToString(" · ")
    }

    /**
     * The tooltip of a test's failing line: why it failed, and the error without its stack; with `edited`, that the
     * line changed since the run.
     */
    fun failureTooltip(headline: String?, message: String?, edited: Boolean = false): String {
        val escape = { text: String -> text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;") }
        val why = headline?.ifBlank { null } ?: "Failed"
        val details = message?.trim()?.ifBlank { null }?.takeIf { it != why }?.let { "<pre>${escape(it)}</pre>" } ?: ""
        val title = if (edited) "Piwi: failed here, edited since the run" else "Piwi: failed here"
        return "<html><b>$title</b><br>${escape(why)}$details</html>"
    }

    /** Where the service found the instance, in the words of the settings page. */
    fun sourceLabel(source: String?): String = when (source) {
        "environment" -> "the environment (PIWI_DASHBOARD_URL)"
        "dotenv" -> "the workspace .env"
        "desktop" -> "the Piwi desktop app"
        else -> "Settings → Tools → Piwi"
    }

    /** One sentence on the connection, for the tool window and the settings page. */
    fun connectionSummary(status: StatusResult?, desktopChosen: Boolean = false): String {
        if (status == null) return NOT_STARTED
        val contexts = status.contexts.orEmpty()
        if (contexts.isEmpty()) return "No Playwright config found in this project."
        val hint = desktopHint(status, desktopChosen).let { if (it.isEmpty()) "" else " $it" }
        val c = contexts.firstOrNull { it.connected }
            ?: return "Not connected. " + (contexts.first().problem ?: "") + hint
        val branch = c.branch?.let { " on $it" } ?: ""
        return "Connected to ${c.projectName ?: "Piwi"}$branch at ${c.serverUrl}, from ${sourceLabel(c.source)}.$hint"
    }

    /**
     * A sentence on the desktop app when it is not in use: it runs and Connect can switch to it,
     * or it was chosen and does not run. Empty otherwise.
     */
    fun desktopHint(status: StatusResult?, desktopChosen: Boolean): String = when {
        status == null || status.contexts.orEmpty().any { it.source == "desktop" } -> ""
        status.desktopUrl != null -> "The Piwi desktop app runs on this machine: Connect to use it."
        desktopChosen -> "The Piwi desktop app, chosen with Connect, is not running."
        else -> ""
    }

    /** What Disconnect asks before forgetting the saved connection; null when nothing is saved. */
    fun disconnectQuestion(serverUrl: String, project: String, desktop: Boolean = false): String? {
        val parts = buildList {
            if (serverUrl.isNotBlank()) add("$serverUrl, the project, and the API key saved for it")
            else if (project.isNotBlank()) add("the project $project saved for the desktop app")
            if (desktop) add("the choice of the desktop app")
        }
        return if (parts.isEmpty()) null else "Forget ${parts.joinToString(", and ")}?"
    }

    enum class ConnectTarget { DESKTOP, INSTANCE, OTHER }

    /** A connection Connect offers when the desktop app runs. */
    data class ConnectChoice(val target: ConnectTarget, val label: String, val detail: String, val serverUrl: String?, val inUse: Boolean)

    /**
     * What Connect offers when the desktop app runs: the app, the instance the environment, the
     * `.env` or the settings name (the app does not replace it: either is one choice away), and
     * another instance.
     */
    fun connectChoices(status: StatusResult?, desktop: DesktopResult, savedUrl: String): List<ConnectChoice> {
        val contexts = status?.contexts.orEmpty()
        val context = contexts.firstOrNull { it.connected } ?: contexts.firstOrNull()
        val usesDesktop = context?.source == "desktop"
        val choices = mutableListOf(
            ConnectChoice(
                ConnectTarget.DESKTOP,
                "The Piwi desktop app, at ${desktop.url}",
                desktop.linked?.let { "Runs on this machine; this folder is linked there to the project ${it.name}." }
                    ?: "Runs on this machine: no address or key needed.",
                null,
                usesDesktop,
            ),
        )
        val named = context?.instance?.serverUrl?.let { it to context.instance.source }
            ?: normalizeServerUrl(savedUrl)?.let { it to "editor" }
        if (named != null && named.first != desktop.url) {
            val (url, source) = named
            choices += ConnectChoice(ConnectTarget.INSTANCE, url, "From ${sourceLabel(source)}.", url, !usesDesktop && context?.serverUrl == url)
        }
        choices += ConnectChoice(ConnectTarget.OTHER, "Another instance…", "A Piwi server, by its address.", null, false)
        return choices
    }

    /** The desktop app's discovery file: its address, its token, and the folders linked to its projects. */
    data class DesktopDiscovery(val url: String, val token: String, val links: List<Pair<Int, String>>)

    /** Where the desktop app publishes its discovery file while it runs: `PIWI_DESKTOP_CONFIG`, else `~/.piwi/desktop.json`. */
    fun desktopConfigPath(env: Map<String, String>, home: String?): Path? =
        env["PIWI_DESKTOP_CONFIG"]?.takeIf { it.isNotBlank() }?.let { Path.of(it) }
            ?: home?.let { Path.of(it, ".piwi", "desktop.json") }

    /** The running desktop app, from its discovery file's text; null when it is not one. */
    fun parseDesktopDiscovery(text: String?): DesktopDiscovery? {
        val json = runCatching { JsonParser.parseString(text ?: return null) as? JsonObject }.getOrNull() ?: return null
        fun string(o: JsonObject, key: String) =
            o.get(key)?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString?.ifBlank { null }
        val url = string(json, "url") ?: return null
        val token = string(json, "token") ?: return null
        val links = (json.get("projects") as? JsonArray)?.mapNotNull { entry ->
            val link = entry as? JsonObject ?: return@mapNotNull null
            val id = link.get("id")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isNumber }?.asInt ?: return@mapNotNull null
            string(link, "path")?.let { id to it }
        }.orEmpty()
        return DesktopDiscovery(url.trimEnd('/'), token, links)
    }

    /**
     * The project the desktop app links to a folder: the linked folder that holds `dir`, or one
     * inside it; the deepest wins.
     */
    fun linkedDesktopProject(links: List<Pair<Int, String>>, dir: Path?): Int? {
        val folder = dir?.toAbsolutePath()?.normalize() ?: return null
        return links
            .filter { (_, path) ->
                val linked = runCatching { Path.of(path).toAbsolutePath().normalize() }.getOrNull()
                linked != null && (folder.startsWith(linked) || linked.startsWith(folder))
            }
            .maxByOrNull { it.second.length }
            ?.first
    }

    /** An instance URL as it is stored: trimmed, without trailing slashes; null when it is not an http(s) URL. */
    fun normalizeServerUrl(input: String?): String? {
        val url = input?.trim()?.trimEnd('/') ?: return null
        return url.takeIf { it.matches(Regex("^https?://[^\\s/]+\\S*$")) }
    }

    private val LOOPBACK_URL = Regex("^(https?://)(localhost|127\\.0\\.0\\.1|\\[::1])(?=[:/?#]|$)", RegexOption.IGNORE_CASE)

    /** Whether an instance URL names this machine: `localhost`, `127.0.0.1` or `[::1]`. */
    fun isLoopback(url: String): Boolean = LOOPBACK_URL.containsMatchIn(url)

    /**
     * The addresses to try for an instance URL: the URL, then, for one on this machine, the same URL
     * on the other loopback addresses. A server started on `localhost` may listen on `::1` only, or on
     * `127.0.0.1` only, whichever the system named first.
     */
    fun loopbackAlternatives(url: String): List<String> {
        val match = LOOPBACK_URL.find(url) ?: return listOf(url)
        val rest = url.substring(match.range.last + 1)
        return (listOf(url) + listOf("127.0.0.1", "[::1]").map { match.groupValues[1] + it + rest }).distinct()
    }

    /**
     * The password-safe entry of an instance's API key. The key is kept per instance: a
     * project's settings, which a repository may commit, never select another instance's key.
     */
    fun apiKeyEntry(serverUrl: String): String = "apiKey ${normalizeServerUrl(serverUrl) ?: serverUrl.trim()}"

    private fun jsonString(value: String): String =
        "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"").replace("\n", "\\n") + "\""

    /**
     * An `mcpServers` entry per instance, bridged to stdio with `mcp-remote` so every
     * MCP client takes it (the JetBrains AI Assistant's settings, Junie, Claude Desktop).
     * The key travels in `env`, never on the command line.
     */
    fun mcpConfiguration(servers: List<McpServerDefinition>): String {
        val entries = servers.mapIndexed { i, s ->
            val name = if (i == 0) "piwi" else "piwi-${i + 1}"
            val auth = s.headers?.get("Authorization")
            val args = mutableListOf("\"-y\"", "\"mcp-remote\"", jsonString(s.url ?: ""))
            if (auth != null) args += listOf("\"--header\"", "\"Authorization:\${PIWI_AUTH}\"")
            val env = if (auth != null) ",\n      \"env\": { \"PIWI_AUTH\": ${jsonString(auth)} }" else ""
            "    ${jsonString(name)}: {\n      \"command\": \"npx\",\n      \"args\": [${args.joinToString(", ")}]$env\n    }"
        }
        return "{\n  \"mcpServers\": {\n${entries.joinToString(",\n")}\n  }\n}"
    }

    /** The command line that runs a shell command string, split as a shell would for plain words and quotes. */
    fun splitCommand(command: String): List<String> {
        val out = mutableListOf<String>()
        val current = StringBuilder()
        var quote: Char? = null
        var inWord = false
        for (c in command) {
            when {
                quote != null && c == quote -> quote = null
                quote != null -> current.append(c)
                c == '"' || c == '\'' -> { quote = c; inWord = true }
                c.isWhitespace() -> if (inWord) { out += current.toString(); current.clear(); inWord = false }
                else -> { current.append(c); inWord = true }
            }
        }
        if (inWord) out += current.toString()
        return out
    }

    /** What Piwi Picker sends: a locator line, or a steps document for the editor service to render. */
    sealed class SendPayload {
        data class Locator(val text: String) : SendPayload()
        data class Steps(val steps: com.google.gson.JsonObject) : SendPayload()
        data class Refused(val error: String) : SendPayload()
    }

    const val MAX_SEND_TEXT = 4000
    const val MAX_SEND_BYTES = 2_000_000

    /** Validate a request body, as `parseSendPayload` in `@piwitests/core/editor-send` does. */
    fun parseSendPayload(body: String): SendPayload {
        val json = try {
            com.google.gson.JsonParser.parseString(body)
        } catch (_: Exception) {
            return SendPayload.Refused("the body must be JSON")
        }
        if (!json.isJsonObject) return SendPayload.Refused("the body must be a JSON object")
        val obj = json.asJsonObject
        val kind = obj.get("kind")?.takeIf { it.isJsonPrimitive }?.asString
        return when (kind) {
            "locator" -> {
                val text = obj.get("text")?.takeIf { it.isJsonPrimitive && it.asJsonPrimitive.isString }?.asString
                when {
                    text.isNullOrBlank() -> SendPayload.Refused("text must be a non-empty string")
                    text.length > MAX_SEND_TEXT -> SendPayload.Refused("text is at most $MAX_SEND_TEXT characters")
                    else -> SendPayload.Locator(text)
                }
            }
            "steps" -> obj.get("steps")?.takeIf { it.isJsonObject }?.let { SendPayload.Steps(it.asJsonObject) }
                ?: SendPayload.Refused("steps must be a steps document")
            else -> SendPayload.Refused("kind must be 'locator' or 'steps'")
        }
    }

    /** Whether an `Authorization` header carries the token, compared in constant time. */
    fun sendAuthorized(header: String?, token: String): Boolean {
        val given = Regex("^Bearer\\s+(\\S+)$", RegexOption.IGNORE_CASE).find(header ?: "")?.groupValues?.get(1) ?: return false
        return token.isNotEmpty() && java.security.MessageDigest.isEqual(given.toByteArray(), token.toByteArray())
    }

    /**
     * What the dashboard's Open in IDE asks (`/api/piwi/open`): a file of a run, as a path relative to the
     * run's working directory or an absolute one, at an optional 1-based line and column. `root` is the
     * working directory when the dashboard knows it (its workspace root setting, the desktop app's linked
     * folder), tried first. With `check`, the IDE only says whether one of its open projects holds the file.
     * `piwiProject` names the Piwi project, which picks the IDE project connected to it when several hold the file.
     */
    sealed class OpenRequest {
        data class File(
            val path: String,
            val line: Int?,
            val column: Int?,
            val check: Boolean,
            val piwiProject: String?,
            val root: String? = null,
        ) : OpenRequest()

        data class Refused(val error: String) : OpenRequest()
    }

    const val MAX_OPEN_PATH = 4096

    /** Why a path given to Open in IDE is refused, or null when it is acceptable. */
    private fun refusedPath(name: String, path: String): String? = when {
        path.length > MAX_OPEN_PATH -> "$name is at most $MAX_OPEN_PATH characters"
        '\u0000' in path -> "$name must not contain a NUL character"
        // A UNC path would make the IDE reach a network share (and send the user's credentials to it).
        path.startsWith("//") -> "network paths are not supported"
        path.split('/').any { it == ".." } -> "$name must not contain '..'"
        else -> null
    }

    /** Read the query of an open request; a missing line or column means none. */
    fun parseOpenRequest(query: Map<String, List<String>>): OpenRequest {
        fun last(name: String) = query[name]?.lastOrNull()?.trim()?.ifEmpty { null }
        val path = last("file")?.replace('\\', '/') ?: return OpenRequest.Refused("file is required")
        refusedPath("file", path)?.let { return OpenRequest.Refused(it) }
        val root = last("root")?.replace('\\', '/')
        if (root != null) {
            refusedPath("root", root)?.let { return OpenRequest.Refused(it) }
            if (!isAbsolutePath(root)) return OpenRequest.Refused("root must be an absolute path")
        }
        val line = last("line")
        val lineNumber = line?.toIntOrNull()
        if (line != null && (lineNumber == null || lineNumber < 1)) return OpenRequest.Refused("line must be a positive integer")
        val column = last("column")
        val columnNumber = column?.toIntOrNull()
        if (column != null && (columnNumber == null || columnNumber < 1)) return OpenRequest.Refused("column must be a positive integer")
        // `?check` and `?check=1` ask for a check; `?check=0` does not.
        val check = query["check"]?.lastOrNull()?.trim()?.let { it != "0" && it != "false" } ?: query.containsKey("check")
        return OpenRequest.File(path, lineNumber, columnNumber, check, last("project"), root)
    }

    /** Whether a path, with forward slashes, is absolute: `/home/me/a.ts` or `C:/me/a.ts`. */
    fun isAbsolutePath(path: String): Boolean = path.startsWith("/") || Regex("^[A-Za-z]:/").containsMatchIn(path)

    /**
     * The files to look for, in order: an absolute path as is; a relative one under each root
     * (the directories a run's paths may start from), each root once.
     */
    fun candidatePaths(path: String, roots: List<String>): List<String> {
        val file = path.replace('\\', '/')
        if (isAbsolutePath(file)) return listOf(file)
        val relative = file.replace(Regex("^(\\./)+"), "").trimStart('/')
        return roots.map { it.replace('\\', '/').trimEnd('/') }.filter { it.isNotEmpty() }.distinct().map { "$it/$relative" }
    }

    /**
     * A block of code re-indented to sit at a line indented with `indent`: its common
     * leading indentation removed, then `indent` added to every line after the first.
     */
    fun indentBlock(code: String, indent: String): String {
        val lines = code.trimEnd().split("\n")
        val common = lines.filter { it.isNotBlank() }.minOfOrNull { it.length - it.trimStart().length } ?: 0
        return lines.mapIndexed { i, line ->
            val stripped = if (line.isBlank()) "" else line.substring(common)
            if (i == 0 || stripped.isEmpty()) stripped else indent + stripped
        }.joinToString("\n")
    }

    /** How a desktop job's update shows (`desktopJobNotice` in the VS Code extension). */
    data class DesktopJobNotice(val text: String, val warning: Boolean, val actions: List<String>)

    /**
     * A job that ended without a verdict (declined, expired, the app gone, or an error) shows as a warning, anything
     * else as information, with the share button when the verdict can be shared.
     */
    fun desktopJobNotice(update: DesktopJobUpdate): DesktopJobNotice {
        val message = update.message.orEmpty()
        val failed = update.status != "done" && update.status != "running"
        return DesktopJobNotice(
            text = message,
            warning = failed || message.startsWith("The desktop app could not"),
            actions = listOfNotNull(update.share?.label),
        )
    }

    /** The extensions of the files a recording writes into: JavaScript and TypeScript. */
    val SCRIPT_EXTENSIONS = setOf("ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts")

    /**
     * Where a recording started at a position writes, from where `piwi/pageCandidates` says the position is: outside
     * every test, function and class (`file`), a new test (`test`); anywhere else, the steps there (`steps`), which the
     * editor service refuses where they cannot go.
     */
    fun recordInto(context: String): String = if (context == "file") "test" else "steps"

    /**
     * The recorded block as the file holds it: the lines of `code`, each one that is not blank prefixed with `indent`,
     * the blank ones empty.
     */
    fun recordedBlock(code: String, indent: String): String =
        code.replace("\r\n", "\n").replace('\r', '\n').split('\n').joinToString("\n") { if (it.isBlank()) "" else indent + it }

    /** A first write of a recorded block: the range `[start, end)` of the text it replaces, what goes there, and where the block starts after it. */
    data class BlockWrite(val start: Int, val end: Int, val text: String, val blockStart: Int)

    /**
     * Where a recorded block is first written into a document's text, at `offset`: the start of the line the placement
     * names, followed through the edits since. A blank line there takes the block, unless `newLine`; otherwise the block
     * goes on a new line inserted there, pushing that line down. An offset within a line (at the end of a last line
     * with text, or after the line break before it was removed) puts the block on a new line after that line. A block
     * that takes the place of the text's last line is followed by a line break, so the file still ends with one.
     */
    fun firstBlockWrite(text: CharSequence, offset: Int, newLine: Boolean, block: String): BlockWrite {
        val at = offset.coerceIn(0, text.length)
        val lineStart = text.lastIndexOf('\n', at - 1) + 1
        val lineEnd = text.indexOf('\n', at).let { if (it < 0) text.length else it }
        if (lineStart != at) return BlockWrite(lineEnd, lineEnd, "\n" + block, lineEnd + 1)
        if (newLine || text.subSequence(lineStart, lineEnd).isNotBlank()) return BlockWrite(at, at, block + "\n", at)
        return BlockWrite(lineStart, lineEnd, if (lineEnd == text.length) block + "\n" else block, lineStart)
    }

    /** A change of a document's text: the `oldLength` characters at `offset` replaced with `text`. */
    data class TextChange(val offset: Int, val oldLength: Int, val text: String)

    /**
     * Where the start of line `line` of `text` (its end, past its last line) is once `changes` were made to it, in
     * order. A change before it moves it; one that ends on it moves it to that change's end; one that inserts at it, or
     * replaces text around it, leaves it after the last line break the change wrote, else at the change's start.
     */
    fun followLineStart(text: CharSequence, line: Int, changes: List<TextChange>): Int {
        var offset = 0
        var lines = 0
        while (lines < line && offset < text.length) {
            offset = text.indexOf('\n', offset).let { if (it < 0) text.length else it + 1 }
            lines++
        }
        for (change in changes) {
            val end = change.offset + change.oldLength
            offset = when {
                end < offset || (end == offset && change.oldLength > 0) -> offset + change.text.length - change.oldLength
                change.offset > offset -> offset
                else -> change.offset + change.text.lastIndexOf('\n') + 1
            }
        }
        return offset
    }

    /** Import lines to insert into a document's text at `offset`. */
    data class ImportInsertion(val offset: Int, val text: String)

    /**
     * The import lines of `imports` a document's text lacks, and where they go: after its last top-level `import`
     * statement, else at its top, followed by an empty line. A line is left out when the file holds the same statement,
     * whatever its spacing, its quotes and its final semicolon.
     */
    fun importInsertion(text: CharSequence, imports: List<String>): ImportInsertion? {
        val statements = importStatements(text)
        val held = statements.map { importKey(it.text) }.toSet()
        val missing = imports.map { it.replace("\r\n", "\n").replace('\r', '\n').trim() }
            .filter { it.isNotEmpty() && importKey(it) !in held }
            .distinctBy { importKey(it) }
        if (missing.isEmpty()) return null
        val last = statements.lastOrNull()
        if (last != null) return ImportInsertion(last.end, "\n" + missing.joinToString("\n"))
        val firstLine = text.subSequence(0, text.indexOf('\n').let { if (it < 0) text.length else it })
        return ImportInsertion(0, missing.joinToString("\n") + "\n" + if (firstLine.isBlank()) "" else "\n")
    }

    /** A top-level `import` statement: its text, over one line or more, and the offset its last line ends at. */
    private data class ImportStatement(val text: String, val end: Int)

    private val IMPORT_START = Regex("^import(?=[\\s{*'\"])")
    private val IMPORT_COMPLETE = Regex("\\bfrom\\s*['\"]|^import\\s*['\"]|=\\s*require\\s*\\(|;\\s*$")

    /** The top-level `import` statements of a text, in order: those starting a line, followed to their module. */
    private fun importStatements(text: CharSequence): List<ImportStatement> {
        val lines = text.split('\n')
        val found = mutableListOf<ImportStatement>()
        var start = 0
        var i = 0
        while (i < lines.size) {
            if (!IMPORT_START.containsMatchIn(lines[i])) {
                start += lines[i].length + 1
                i++
                continue
            }
            var statement = lines[i]
            var end = start + lines[i].length
            var j = i
            while (!IMPORT_COMPLETE.containsMatchIn(statement) && j + 1 < lines.size && j - i < 50) {
                j++
                statement += "\n" + lines[j]
                end += 1 + lines[j].length
            }
            found += ImportStatement(statement, end)
            start = end + 1
            i = j + 1
        }
        return found
    }

    /** An `import` statement compared regardless of its spacing, its quotes and its final semicolon. */
    private fun importKey(statement: String): String =
        statement.replace(Regex("\\s+"), "").replace('"', '\'').removeSuffix(";")

    /** "1 step", "3 steps". */
    fun stepCount(steps: Int): String = if (steps == 1) "1 step" else "$steps steps"

    /** What the banner over a file a recording writes into offers. */
    enum class RecordingAction { STOP, PAUSE, RESUME, KEEP_EDITS }

    /** The banner over a file a recording writes into: what the recording does, and the actions it offers. */
    data class RecordingBanner(val text: String, val actions: List<RecordingAction>)

    /**
     * The banner of a recording in `state`, with `steps` written so far: while the browser opens, while recording, while
     * paused. Once the developer changed the recorded lines (`edited`), it offers to resume, which writes them again, or
     * to keep the edits, which ends the recording; once Stop is clicked (`stopping`), nothing. The service's `message`,
     * if any, follows.
     */
    fun recordingBanner(state: String?, steps: Int, edited: Boolean, stopping: Boolean, message: String?): RecordingBanner {
        val (text, actions) = when {
            stopping -> "Piwi: stopping the recording…" to emptyList()
            edited -> "Piwi: recording paused, since you changed the recorded lines. Resume writes them again from the browser." to
                listOf(RecordingAction.RESUME, RecordingAction.KEEP_EDITS)
            state == "starting" -> "Piwi: opening the browser to record into this file…" to listOf(RecordingAction.STOP)
            state == "paused" -> "Piwi: recording paused · ${stepCount(steps)}" to listOf(RecordingAction.RESUME, RecordingAction.STOP)
            else -> "Piwi is recording what you do in the browser · ${stepCount(steps)}" to
                listOf(RecordingAction.PAUSE, RecordingAction.STOP)
        }
        val note = message?.trim()?.ifEmpty { null }?.takeUnless { stopping }
        return RecordingBanner(if (note == null) text else "$text · $note", actions)
    }

    /** The status bar while a recording runs: its state and its step count. */
    fun recordingStatus(state: String?, steps: Int, edited: Boolean, stopping: Boolean): String = when {
        stopping -> "Piwi: stopping the recording"
        state == "starting" -> "Piwi: opening the browser"
        edited || state == "paused" -> "Piwi: recording paused · ${stepCount(steps)}"
        else -> "Piwi: ● recording · ${stepCount(steps)}"
    }

    /** The notification when a recording ends: why, if the service said, what was written where, and the warnings to check. */
    fun recordingSummary(steps: Int, warnings: Int, file: String, message: String?): String {
        val written = if (steps == 0) "Nothing was recorded into $file." else "Recorded ${stepCount(steps)} into $file."
        val check = when (warnings) {
            0 -> ""
            1 -> " 1 warning to check, on its line."
            else -> " $warnings warnings to check, on their lines."
        }
        return listOfNotNull(message?.trim()?.ifEmpty { null }, written + check).joinToString(" ")
    }

    /**
     * The name of a new spec file from what was typed: as typed when it ends with a script extension, `.ts` added after
     * `.spec` or `.test`, else `.spec.ts`. Null when it is blank or names a folder.
     */
    fun specFileName(input: String): String? {
        val name = input.trim()
        if (name.isEmpty() || '/' in name || '\\' in name || name.all { it == '.' }) return null
        return when {
            name.substringAfterLast('.', "").lowercase() in SCRIPT_EXTENSIONS -> name
            name.endsWith(".spec") || name.endsWith(".test") -> "$name.ts"
            else -> "$name.spec.ts"
        }
    }
}
