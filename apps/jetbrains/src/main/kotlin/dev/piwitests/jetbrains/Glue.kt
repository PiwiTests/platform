package dev.piwitests.jetbrains

/**
 * What the plugin shows, computed from the editor service's answers with no
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
