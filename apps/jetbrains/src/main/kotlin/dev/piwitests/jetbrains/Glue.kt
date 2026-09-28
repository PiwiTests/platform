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

    data class StatusView(val text: String, val tooltip: String, val url: String?, val connect: Boolean)

    /** The status bar text: the latest run on the checked-out branch, or what keeps the service from reading it. */
    fun statusView(status: StatusResult?, runs: RunStatusResult?): StatusView {
        val contexts = status?.contexts.orEmpty()
        if (contexts.isEmpty()) return StatusView("Piwi", "No Playwright config found", null, false)
        val connected = contexts.firstOrNull { it.connected }
            ?: return StatusView("Piwi: connect", contexts.first().problem ?: "Not connected", null, true)
        val run = runs?.contexts?.firstOrNull { it.root == connected.root } ?: runs?.contexts?.firstOrNull()
        val where = (connected.projectName ?: "Piwi") + (run?.branch?.let { " on $it" } ?: "")
        val r = run?.run ?: return StatusView("Piwi: no run", "No run of $where yet", null, false)
        val tooltip = "Run #${r.id} of $where: ${r.passedTests} passed, ${r.failedTests} failed, " +
            "${r.flakyTests} flaky, ${r.skippedTests} skipped"
        val flaky = if (r.flakyTests > 0) " · ${r.flakyTests} flaky" else ""
        return when {
            r.status in ACTIVE -> {
                val done = r.passedTests + r.failedTests + r.flakyTests + r.skippedTests
                val failing = if (r.failedTests > 0) " · ${r.failedTests} failing" else ""
                StatusView("Piwi: $done/${r.totalTests}$failing", tooltip, r.url, false)
            }
            r.failedTests > 0 -> StatusView("Piwi: ${r.failedTests} failing$flaky", tooltip, r.url, false)
            r.status != "passed" && r.status != "failed" -> StatusView("Piwi: ${r.status}", tooltip, r.url, false)
            else -> StatusView("Piwi: ${r.passedTests} passed$flaky", tooltip, r.url, false)
        }
    }

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
}
