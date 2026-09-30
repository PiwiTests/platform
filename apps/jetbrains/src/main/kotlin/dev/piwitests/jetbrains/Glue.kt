package dev.piwitests.jetbrains

import java.io.IOException
import java.nio.file.FileVisitResult
import java.nio.file.Files
import java.nio.file.Path
import java.nio.file.SimpleFileVisitor
import java.nio.file.attribute.BasicFileAttributes

/**
 * What the plugin shows, computed from the editor service's answers, and where
 * it looks for Playwright configs, with no platform API, so it is tested
 * without an IDE.
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

    /** What a click on the status bar item does. */
    enum class StatusAction { OPEN, CONNECT, SETTINGS, NONE }

    data class StatusView(val text: String, val tooltip: String, val url: String?, val action: StatusAction)

    /**
     * The status bar text: the latest run on the checked-out branch, or what keeps the service from reading it.
     * A null status means the service has not started: it starts with the first file of the project opened.
     */
    fun statusView(status: StatusResult?, runs: RunStatusResult?): StatusView {
        if (status == null) return StatusView("Piwi", "$NOT_STARTED Click for Piwi's settings.", null, StatusAction.SETTINGS)
        val contexts = status.contexts.orEmpty()
        if (contexts.isEmpty()) return StatusView("Piwi", "No Playwright config found", null, StatusAction.NONE)
        val connected = contexts.firstOrNull { it.connected }
            ?: return StatusView("Piwi: connect", contexts.first().problem ?: "Not connected", null, StatusAction.CONNECT)
        val run = runs?.contexts?.firstOrNull { it.root == connected.root } ?: runs?.contexts?.firstOrNull()
        val where = (connected.projectName ?: "Piwi") + (run?.branch?.let { " on $it" } ?: "")
        val from = connected.serverUrl?.let { url -> "\n$url, from ${sourceLabel(connected.source)}" } ?: ""
        val r = run?.run ?: return StatusView("Piwi: no run", "No run of $where yet$from", null, StatusAction.NONE)
        val tooltip = "Run #${r.id} of $where: ${r.passedTests} passed, ${r.failedTests} failed, " +
            "${r.flakyTests} flaky, ${r.skippedTests} skipped$from"
        val flaky = if (r.flakyTests > 0) " · ${r.flakyTests} flaky" else ""
        val open = StatusAction.OPEN
        return when {
            r.status in ACTIVE -> {
                val done = r.passedTests + r.failedTests + r.flakyTests + r.skippedTests
                val failing = if (r.failedTests > 0) " · ${r.failedTests} failing" else ""
                StatusView("Piwi: $done/${r.totalTests}$failing", tooltip, r.url, open)
            }
            r.failedTests > 0 -> StatusView("Piwi: ${r.failedTests} failing$flaky", tooltip, r.url, open)
            r.status != "passed" && r.status != "failed" -> StatusView("Piwi: ${r.status}", tooltip, r.url, open)
            else -> StatusView("Piwi: ${r.passedTests} passed$flaky", tooltip, r.url, open)
        }
    }

    const val NOT_STARTED = "Piwi starts when you open a file of this project."

    /** Where the service found the instance, in the words of the settings page. */
    fun sourceLabel(source: String?): String = when (source) {
        "environment" -> "the environment (PIWI_DASHBOARD_URL)"
        "dotenv" -> "the workspace .env"
        "desktop" -> "the Piwi desktop app"
        else -> "Settings → Tools → Piwi"
    }

    /** One sentence on the connection, for the tool window and the settings page. */
    fun connectionSummary(status: StatusResult?): String {
        if (status == null) return NOT_STARTED
        val contexts = status.contexts.orEmpty()
        if (contexts.isEmpty()) return "No Playwright config found in this project."
        val c = contexts.firstOrNull { it.connected }
            ?: return "Not connected. " + (contexts.first().problem ?: "")
        val branch = c.branch?.let { " on $it" } ?: ""
        return "Connected to ${c.projectName ?: "Piwi"}$branch at ${c.serverUrl}, from ${sourceLabel(c.source)}."
    }

    /** What Disconnect asks before forgetting the saved connection; null when nothing is saved. */
    fun disconnectQuestion(serverUrl: String, project: String): String? = when {
        serverUrl.isNotBlank() -> "Forget $serverUrl, the project, and the API key saved for it?"
        project.isNotBlank() -> "Forget the project $project saved for the desktop app?"
        else -> null
    }

    /** An instance URL as it is stored: trimmed, without trailing slashes; null when it is not an http(s) URL. */
    fun normalizeServerUrl(input: String?): String? {
        val url = input?.trim()?.trimEnd('/') ?: return null
        return url.takeIf { it.matches(Regex("^https?://[^\\s/]+\\S*$")) }
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
}
