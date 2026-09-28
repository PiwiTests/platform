package dev.piwitests.jetbrains

import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Test

class GlueTest {
    private val connected = StatusResult(
        listOf(ContextStatus(root = "/w", connected = true, serverUrl = "http://piwi", projectId = 7, projectName = "Acme")),
    )

    private fun runs(run: RunInfo?) = RunStatusResult(listOf(RunStatus(root = "/w", branch = "feature/pay", run = run)))

    private val passed = RunInfo(
        id = 41, status = "passed", totalTests = 120, passedTests = 118, flakyTests = 2, url = "http://piwi/test-runs/41",
    )

    @Test
    fun `without a Playwright config, says so`() {
        assertEquals("Piwi", Glue.statusView(StatusResult(emptyList()), null).text)
    }

    @Test
    fun `when not connected, offers Connect with the reason`() {
        val view = Glue.statusView(StatusResult(listOf(ContextStatus(root = "/w", problem = "No project chosen."))), null)
        assertEquals(Glue.StatusView("Piwi: connect", "No project chosen.", null, true), view)
    }

    @Test
    fun `a passing run, with its flaky tests`() {
        assertEquals(
            Glue.StatusView(
                "Piwi: 118 passed · 2 flaky",
                "Run #41 of Acme on feature/pay: 118 passed, 0 failed, 2 flaky, 0 skipped",
                "http://piwi/test-runs/41",
                false,
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
    fun `a rendered body is re-indented at the caret's indentation`() {
        assertEquals(
            "await page.goto('/cart');\n    await page.getByRole('button').click();",
            Glue.indentBlock("  await page.goto('/cart');\n  await page.getByRole('button').click();\n", "    "),
        )
    }
}
