package dev.piwitests.jetbrains

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Test

class GlueTest {
    private val connected = StatusResult(
        listOf(ContextStatus(
            root = "/w", connected = true, serverUrl = "http://piwi", source = "dotenv", projectId = 7, projectName = "Acme",
            branch = "main",
        )),
    )

    private fun runs(run: RunInfo?) = RunStatusResult(listOf(RunStatus(root = "/w", branch = "feature/pay", run = run)))

    private val passed = RunInfo(
        id = 41, status = "passed", totalTests = 120, passedTests = 118, flakyTests = 2, url = "http://piwi/test-runs/41",
    )

    @Test
    fun `before the service starts, says when it will and leads to the settings`() {
        val view = Glue.statusView(null, null)
        assertEquals("Piwi", view.text)
        assertEquals(Glue.StatusAction.SETTINGS, view.action)
        assertEquals(Glue.NOT_STARTED, Glue.connectionSummary(null))
    }

    @Test
    fun `without a Playwright config, says so`() {
        assertEquals("Piwi", Glue.statusView(StatusResult(emptyList()), null).text)
    }

    @Test
    fun `when not connected, offers Connect with the reason`() {
        val view = Glue.statusView(StatusResult(listOf(ContextStatus(root = "/w", problem = "No project chosen."))), null)
        assertEquals(Glue.StatusView("Piwi: connect", "No project chosen.", null, Glue.StatusAction.CONNECT), view)
    }

    @Test
    fun `a passing run, with its flaky tests`() {
        assertEquals(
            Glue.StatusView(
                "Piwi: 118 passed · 2 flaky",
                "Run #41 of Acme on feature/pay: 118 passed, 0 failed, 2 flaky, 0 skipped\nhttp://piwi, from the workspace .env",
                "http://piwi/test-runs/41",
                Glue.StatusAction.OPEN,
            ),
            Glue.statusView(connected, runs(passed)),
        )
    }

    @Test
    fun `a failing run, a running run, an interrupted run and no run`() {
        assertEquals("Piwi: 3 failing · 2 flaky", Glue.statusView(connected, runs(passed.copy(status = "failed", failedTests = 3))).text)
        assertEquals(
            "Piwi: 41/120 · 1 failing",
            Glue.statusView(connected, runs(passed.copy(status = "running", passedTests = 40, failedTests = 1, flakyTests = 0))).text,
        )
        assertEquals("Piwi: interrupted", Glue.statusView(connected, runs(passed.copy(status = "interrupted"))).text)
        assertEquals("Piwi: no run", Glue.statusView(connected, runs(null)).text)
    }

    @Test
    fun `the connection in one sentence, with where it came from`() {
        assertEquals("Connected to Acme on main at http://piwi, from the workspace .env.", Glue.connectionSummary(connected))
        assertEquals(
            "Not connected. No project chosen.",
            Glue.connectionSummary(StatusResult(listOf(ContextStatus(root = "/w", problem = "No project chosen.")))),
        )
        assertEquals("the environment (PIWI_DASHBOARD_URL)", Glue.sourceLabel("environment"))
        assertEquals("Settings → Tools → Piwi", Glue.sourceLabel("editor"))
    }

    @Test
    fun `an instance URL is stored trimmed, and its key is kept under it`() {
        assertEquals("https://piwi.corp", Glue.normalizeServerUrl("  https://piwi.corp//  "))
        assertEquals("http://localhost:3000/piwi", Glue.normalizeServerUrl("http://localhost:3000/piwi/"))
        assertEquals(null, Glue.normalizeServerUrl("piwi.corp"))
        assertEquals(null, Glue.normalizeServerUrl("ftp://piwi.corp"))
        assertEquals(null, Glue.normalizeServerUrl("https://"))
        assertEquals("apiKey https://piwi.corp", Glue.apiKeyEntry("https://piwi.corp/"))
    }

    @Test
    fun `the MCP configuration bridges each instance through mcp-remote, the key in env`() {
        val json = JsonParser.parseString(
            Glue.mcpConfiguration(
                listOf(
                    McpServerDefinition("Piwi (a)", "https://a/mcp", mapOf("Authorization" to "Bearer pd_x")),
                    McpServerDefinition("Piwi (b)", "http://b/mcp", emptyMap()),
                ),
            ),
        ).asJsonObject.getAsJsonObject("mcpServers")
        val first = json.getAsJsonObject("piwi")
        assertEquals("npx", first.get("command").asString)
        assertEquals(
            listOf("-y", "mcp-remote", "https://a/mcp", "--header", "Authorization:\${PIWI_AUTH}"),
            first.getAsJsonArray("args").map { it.asString },
        )
        assertEquals("Bearer pd_x", first.getAsJsonObject("env").get("PIWI_AUTH").asString)
        assertEquals(listOf("-y", "mcp-remote", "http://b/mcp"), json.getAsJsonObject("piwi-2").getAsJsonArray("args").map { it.asString })
    }

    @Test
    fun `a command line splits like a shell's words`() {
        assertEquals(
            listOf("npx", "playwright", "show-trace", "/tmp/a b/trace.zip"),
            Glue.splitCommand("npx playwright show-trace \"/tmp/a b/trace.zip\""),
        )
        assertEquals(listOf("npx", "playwright", "test", "tests/a.spec.ts:3"), Glue.splitCommand("npx  playwright test tests/a.spec.ts:3"))
    }

    @Test
    fun `a send payload is a locator line or a steps document`() {
        assertEquals(Glue.SendPayload.Locator("page.getByRole('button')"), Glue.parseSendPayload("""{"kind":"locator","text":"page.getByRole('button')"}"""))
        assertEquals(true, Glue.parseSendPayload("""{"kind":"steps","steps":{"v":1}}""") is Glue.SendPayload.Steps)
        assertEquals(Glue.SendPayload.Refused("the body must be JSON"), Glue.parseSendPayload("{"))
        assertEquals(Glue.SendPayload.Refused("text must be a non-empty string"), Glue.parseSendPayload("""{"kind":"locator","text":" "}"""))
        assertEquals(Glue.SendPayload.Refused("steps must be a steps document"), Glue.parseSendPayload("""{"kind":"steps"}"""))
        assertEquals(Glue.SendPayload.Refused("kind must be 'locator' or 'steps'"), Glue.parseSendPayload("""{"kind":"file"}"""))
    }

    @Test
    fun `only the bearer token authorizes a send`() {
        val token = "abcdefghijklmnop_1234"
        assertEquals(true, Glue.sendAuthorized("Bearer $token", token))
        assertEquals(false, Glue.sendAuthorized("Bearer ${token}x", token))
        assertEquals(false, Glue.sendAuthorized(token, token))
        assertEquals(false, Glue.sendAuthorized(null, token))
        assertEquals(false, Glue.sendAuthorized("Bearer x", ""))
    }

    @Test
    fun `an open request reads the file, its 1-based position, check and the Piwi project`() {
        fun q(vararg pairs: Pair<String, String>) = pairs.groupBy({ it.first }, { it.second })
        assertEquals(
            Glue.OpenRequest.File("tests/a.spec.ts", 12, 3, false, "Shop"),
            Glue.parseOpenRequest(q("file" to "tests/a.spec.ts", "line" to "12", "column" to "3", "project" to "Shop")),
        )
        assertEquals(Glue.OpenRequest.File("C:/repo/a.ts", null, null, true, null), Glue.parseOpenRequest(q("file" to "C:\\repo\\a.ts", "check" to "")))
        assertEquals("C:/repo/e2e", (Glue.parseOpenRequest(q("file" to "a.ts", "root" to "C:\\repo\\e2e")) as Glue.OpenRequest.File).root)
        assertEquals(false, (Glue.parseOpenRequest(q("file" to "a.ts", "check" to "0")) as Glue.OpenRequest.File).check)
        assertEquals(true, (Glue.parseOpenRequest(mapOf("file" to listOf("a.ts"), "check" to emptyList())) as Glue.OpenRequest.File).check)
    }

    @Test
    fun `an open request refuses a missing file, network paths, parent segments and bad positions`() {
        fun refused(vararg pairs: Pair<String, String>) = (Glue.parseOpenRequest(pairs.groupBy({ it.first }, { it.second })) as Glue.OpenRequest.Refused).error
        assertEquals("file is required", refused("line" to "3"))
        assertEquals("network paths are not supported", refused("file" to "\\\\attacker\\share\\a.ts"))
        assertEquals("network paths are not supported", refused("file" to "//attacker/share/a.ts"))
        assertEquals("file must not contain '..'", refused("file" to "tests/../../etc/passwd"))
        assertEquals("line must be a positive integer", refused("file" to "a.ts", "line" to "0"))
        assertEquals("column must be a positive integer", refused("file" to "a.ts", "line" to "2", "column" to "x"))
        assertEquals("root must be an absolute path", refused("file" to "a.ts", "root" to "repo"))
        assertEquals("network paths are not supported", refused("file" to "a.ts", "root" to "\\\\attacker\\share"))
    }

    @Test
    fun `a relative path is looked up under each root once, an absolute one as is`() {
        assertEquals(
            listOf("/repo/e2e/tests/a.spec.ts", "/repo/tests/a.spec.ts"),
            Glue.candidatePaths("./tests/a.spec.ts", listOf("/repo/e2e/", "/repo", "/repo/", "")),
        )
        assertEquals(listOf("C:/repo/web/a.ts"), Glue.candidatePaths("a.ts", listOf("C:\\repo\\web")))
        assertEquals(listOf("/home/me/repo/a.ts"), Glue.candidatePaths("/home/me/repo/a.ts", listOf("/other")))
        assertEquals(listOf("D:/repo/a.ts"), Glue.candidatePaths("D:\\repo\\a.ts", listOf("/other")))
    }

    @Test
    fun `a rendered body is re-indented at the caret's indentation`() {
        assertEquals(
            "await page.goto('/cart');\n    await page.getByRole('button').click();",
            Glue.indentBlock("  await page.goto('/cart');\n  await page.getByRole('button').click();\n", "    "),
        )
    }

    @Test
    fun `Disconnect asks about what is saved, and nothing when nothing is`() {
        assertEquals("Forget https://piwi.corp, the project, and the API key saved for it?", Glue.disconnectQuestion("https://piwi.corp", "Shop"))
        assertEquals("Forget the project Shop saved for the desktop app?", Glue.disconnectQuestion("", "Shop"))
        assertEquals(null, Glue.disconnectQuestion("", ""))
    }

    @Test
    fun `the desktop app is named as a source`() {
        assertEquals("the Piwi desktop app", Glue.sourceLabel("desktop"))
    }
}
