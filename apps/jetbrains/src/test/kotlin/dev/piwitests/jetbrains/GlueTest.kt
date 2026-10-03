package dev.piwitests.jetbrains

import com.google.gson.Gson
import com.google.gson.JsonParser
import org.junit.Assert.assertEquals
import org.junit.Test
import java.nio.file.Files
import java.nio.file.Path

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
        assertEquals("Forget the choice of the desktop app?", Glue.disconnectQuestion("", "", desktop = true))
        assertEquals(
            "Forget https://piwi.corp, the project, and the API key saved for it, and the choice of the desktop app?",
            Glue.disconnectQuestion("https://piwi.corp", "Shop", desktop = true),
        )
    }

    @Test
    fun `an instance on this machine is tried on every loopback address`() {
        assertEquals(
            listOf("http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"),
            Glue.loopbackAlternatives("http://localhost:3000"),
        )
        assertEquals(listOf("http://127.0.0.1:3000/piwi", "http://[::1]:3000/piwi"), Glue.loopbackAlternatives("http://127.0.0.1:3000/piwi"))
        assertEquals(listOf("https://LOCALHOST", "https://127.0.0.1", "https://[::1]"), Glue.loopbackAlternatives("https://LOCALHOST"))
        assertEquals(listOf("http://localhost.example.com:3000"), Glue.loopbackAlternatives("http://localhost.example.com:3000"))
        assertEquals(listOf("https://piwi.corp"), Glue.loopbackAlternatives("https://piwi.corp"))
        assertEquals(true, Glue.isLoopback("http://[::1]:3000"))
        assertEquals(false, Glue.isLoopback("http://127.0.0.10:3000"))
    }

    @Test
    fun `the desktop app is named as a source`() {
        assertEquals("the Piwi desktop app", Glue.sourceLabel("desktop"))
    }

    private val desktop = DesktopResult("http://127.0.0.1:3000", listOf(ProjectRef(3, "Shop")), ProjectRef(3, "Shop"))

    private val team = StatusResult(
        listOf(connected.contexts!!.single().copy(instance = NamedInstance("http://piwi", "dotenv"))),
        desktopUrl = "http://127.0.0.1:3000",
    )

    @Test
    fun `Connect offers the desktop app, the instance the project names, and another one`() {
        assertEquals(
            listOf(
                Glue.ConnectChoice(
                    Glue.ConnectTarget.DESKTOP,
                    "The Piwi desktop app, at http://127.0.0.1:3000",
                    "Runs on this machine; this folder is linked there to the project Shop.",
                    null,
                    false,
                ),
                Glue.ConnectChoice(Glue.ConnectTarget.INSTANCE, "http://piwi", "From the workspace .env.", "http://piwi", true),
                Glue.ConnectChoice(Glue.ConnectTarget.OTHER, "Another instance…", "A Piwi server, by its address.", null, false),
            ),
            Glue.connectChoices(team, desktop, ""),
        )
        // With the app in use, the instance is still one choice away; saved only in the settings, it comes from there.
        val onDesktop = StatusResult(
            listOf(team.contexts!!.single().copy(serverUrl = "http://127.0.0.1:3000", source = "desktop", instance = null)),
            desktopUrl = "http://127.0.0.1:3000",
        )
        val choices = Glue.connectChoices(onDesktop, desktop, "https://piwi.corp/")
        assertEquals(listOf(true, false, false), choices.map { it.inUse })
        assertEquals("https://piwi.corp" to "From Settings → Tools → Piwi.", choices[1].serverUrl to choices[1].detail)
        // Before the service starts: the app and the instance saved here.
        assertEquals(3, Glue.connectChoices(null, desktop, "https://piwi.corp").size)
    }

    @Test
    fun `the status says when the desktop app runs unused, or was chosen and does not run`() {
        assertEquals(
            "Connected to Acme on main at http://piwi, from the workspace .env. " +
                "The Piwi desktop app runs on this machine: Connect to use it.",
            Glue.connectionSummary(team),
        )
        assertEquals(
            "The Piwi desktop app, chosen with Connect, is not running.",
            Glue.statusView(connected, runs(passed), desktopChosen = true).tooltip.lines().last(),
        )
        assertEquals("", Glue.desktopHint(connected, desktopChosen = false))
    }

    @Test
    fun `reads the desktop app's discovery file, and the deepest linked folder wins`() {
        val discovery = Glue.parseDesktopDiscovery(
            """{"url":"http://127.0.0.1:3000/","token":"pd_x","projects":[{"id":"3","path":"/a"},{"id":5},""" +
                """{"id":6,"path":"/w"},{"id":8,"path":"/w/app"}]}""",
        )
        assertEquals(Glue.DesktopDiscovery("http://127.0.0.1:3000", "pd_x", listOf(6 to "/w", 8 to "/w/app")), discovery)
        assertEquals(8, Glue.linkedDesktopProject(discovery!!.links, Path.of("/w/app/tests")))
        assertEquals(6, Glue.linkedDesktopProject(discovery.links, Path.of("/w/other")))
        assertEquals(null, Glue.linkedDesktopProject(discovery.links, Path.of("/elsewhere")))
        assertEquals(null, Glue.parseDesktopDiscovery("""{"url":"http://127.0.0.1:3000"}"""))
        assertEquals(null, Glue.parseDesktopDiscovery("not json"))
        assertEquals(Path.of("/tmp/d.json"), Glue.desktopConfigPath(mapOf("PIWI_DESKTOP_CONFIG" to "/tmp/d.json"), "/home/me"))
        assertEquals(Path.of("/home/me", ".piwi", "desktop.json"), Glue.desktopConfigPath(emptyMap(), "/home/me"))
    }

    private fun tree(vararg files: String): Path {
        val dir = Files.createTempDirectory("piwi-glue").toRealPath()
        for (file in files) {
            val path = dir.resolve(file)
            Files.createDirectories(path.parent)
            Files.writeString(path, "")
        }
        return dir
    }

    @Test
    fun `the failing line's tooltip says why, with the message escaped`() {
        assertEquals(
            "<html><b>Piwi: failed here</b><br>Timeout waiting for &lt;button&gt;<pre>Error: click\n  - waiting for &lt;button&gt; &amp; more</pre></html>",
            Glue.failureTooltip("Timeout waiting for <button>", "Error: click\n  - waiting for <button> & more\n"),
        )
        assertEquals("<html><b>Piwi: failed here</b><br>Failed</html>", Glue.failureTooltip(null, " "))
        assertEquals("<html><b>Piwi: failed here</b><br>boom</html>", Glue.failureTooltip("boom", "boom"))
    }

    @Test
    fun `a Rider solution's files are in the folder above its idea folder`() {
        assertEquals("C:/src/Shop", Glue.projectFolder("C:\\src\\Shop\\.idea\\.idea.Shop"))
        assertEquals("/home/me/Shop", Glue.projectFolder("/home/me/Shop/.idea/.idea.Shop.dir/"))
        assertEquals("/home/me/shop", Glue.projectFolder("/home/me/shop"))
    }

    @Test
    fun `folders inside another one are searched with it`() {
        fun path(p: String) = Path.of(p).toAbsolutePath()
        assertEquals(
            listOf(path("/w/shop"), path("/elsewhere")),
            Glue.outermost(listOf(path("/w/shop"), path("/w/shop/src/Api"), path("/w/shop"), path("/elsewhere"))),
        )
    }

    @Test
    fun `finds the configs down to four levels, past dependencies and hidden folders`() {
        val dir = tree(
            "playwright.config.ts",
            "apps/web/e2e/tests/playwright.config.mjs",
            "a/b/c/d/e/playwright.config.ts",
            "node_modules/pkg/playwright.config.js",
            ".cache/playwright.config.ts",
            "src/Shop/bin/playwright.config.txt",
        )
        assertEquals(listOf(dir, dir.resolve("apps/web/e2e/tests")), Glue.playwrightConfigDirs(listOf(dir)))
    }

    @Test
    fun `a solution in a subfolder finds the tests beside it in the repository`() {
        val repo = tree(".git/HEAD", "backend/Shop.sln", "e2e/playwright.config.ts")
        val found = Glue.findPlaywright(listOf(repo.resolve("backend"), repo.resolve("backend/.idea/.idea.Shop")), null)
        assertEquals(Glue.PlaywrightSearch(listOf(repo), listOf(repo.resolve("e2e"))), found)
        // The project's own folders come first: a config there keeps the search to them.
        val backend = repo.resolve("backend")
        Files.writeString(backend.resolve("playwright.config.ts"), "")
        assertEquals(Glue.PlaywrightSearch(listOf(backend), listOf(backend)), Glue.findPlaywright(listOf(backend), null))
    }

    @Test
    fun `a Flake Lab job's results are offered for sharing, and a lab that could not run warns`() {
        val shared = Glue.desktopJobNotice(
            DesktopJobUpdate(
                jobId = "f00d",
                kind = "flake-lab",
                status = "done",
                message = "Flake Lab reproduced \"t\" at b0b0b0b.",
                share = DesktopJobShare("Share on piwi.example.com"),
            ),
        )
        assertEquals(
            Glue.DesktopJobNotice("Flake Lab reproduced \"t\" at b0b0b0b.", false, listOf("Share on piwi.example.com")),
            shared,
        )
        val failed = Glue.desktopJobNotice(
            DesktopJobUpdate(
                kind = "flake-lab",
                status = "done",
                message = "The desktop app could not run Flake Lab on \"t\": npm ci failed",
            ),
        )
        assertEquals(true, failed.warning)
        assertEquals(emptyList<String>(), failed.actions)
    }

    @Test
    fun `a Flake Lab job's arguments keep the test through the command`() {
        val params = Gson().fromJson("""{"root":"/shop","testCaseId":9,"kind":"flake-lab"}""", DesktopJobParams::class.java)
        assertEquals(DesktopJobParams(root = "/shop", testCaseId = 9, kind = "flake-lab"), params)
        assertEquals(null, params.executionId)
    }

    @Test
    fun `a repository in the home folder is not searched`() {
        val home = tree(".git/HEAD", "work/other/playwright.config.ts", "work/shop/Shop.sln")
        val shop = home.resolve("work/shop")
        assertEquals(Glue.PlaywrightSearch(listOf(shop), emptyList()), Glue.findPlaywright(listOf(shop), home))
    }

    @Test
    fun `a recording writes steps inside a test or a class, and a new test anywhere else`() {
        assertEquals("steps", Glue.recordInto("test"))
        assertEquals("steps", Glue.recordInto("class"))
        assertEquals("test", Glue.recordInto("file"))
        assertEquals("test", Glue.recordInto(null))
    }

    @Test
    fun `the recorded block indents each line with text, and leaves blank lines empty`() {
        assertEquals(
            "    test('t', async ({ page }) => {\n      await page.goto('/');\n\n    });",
            Glue.recordedBlock("test('t', async ({ page }) => {\n  await page.goto('/');\n   \n});", "    "),
        )
        assertEquals("\tawait a();\n\tawait b();", Glue.recordedBlock("await a();\r\nawait b();", "\t"))
        assertEquals("", Glue.recordedBlock("", "  "))
    }

    @Test
    fun `a block goes on a new line pushing the line there down, or takes a blank line's place`() {
        val text = "test('t', async ({ page }) => {\n  await page.goto('/');\n});\n"
        val closing = text.indexOf("});")
        assertEquals(Glue.BlockWrite(closing, closing, "  B\n", closing), Glue.firstBlockWrite(text, closing, newLine = true, block = "  B"))
        val blank = "test('t', async ({ page }) => {\n    \n});\n"
        val blankLine = blank.indexOf("    ")
        assertEquals(
            Glue.BlockWrite(blankLine, blankLine + 4, "  B", blankLine),
            Glue.firstBlockWrite(blank, blankLine, newLine = false, block = "  B"),
        )
        // A line that is not blank, or a placement asking for a new line, is pushed down.
        assertEquals(Glue.BlockWrite(closing, closing, "  B\n", closing), Glue.firstBlockWrite(text, closing, newLine = false, block = "  B"))
        assertEquals(
            Glue.BlockWrite(blankLine, blankLine, "  B\n", blankLine),
            Glue.firstBlockWrite(blank, blankLine, newLine = true, block = "  B"),
        )
    }

    @Test
    fun `a block on the last line keeps the final line break, and one after a last line with text goes below it`() {
        assertEquals(Glue.BlockWrite(4, 4, "B\n", 4), Glue.firstBlockWrite("});\n", 4, newLine = false, block = "B"))
        assertEquals(Glue.BlockWrite(0, 0, "B\n", 0), Glue.firstBlockWrite("", 0, newLine = false, block = "B"))
        assertEquals(Glue.BlockWrite(4, 6, "B\n", 4), Glue.firstBlockWrite("});\n  ", 4, newLine = false, block = "B"))
        assertEquals(Glue.BlockWrite(3, 3, "\nB", 4), Glue.firstBlockWrite("});", 3, newLine = true, block = "B"))
        // An anchor left within a line, once the line break before it was removed: the block goes after that line.
        assertEquals(Glue.BlockWrite(8, 8, "\nB", 9), Glue.firstBlockWrite("a();b();\nc();", 4, newLine = false, block = "B"))
    }

    @Test
    fun `the imports a block needs go after the file's last import, each once`() {
        val text = "import { test, expect } from '@playwright/test';\nimport {\n  login,\n  logout,\n} from './helpers';\n\ntest('t', async () => {});\n"
        val afterImports = text.indexOf("\n\ntest")
        assertEquals(
            Glue.ImportInsertion(afterImports, "\nimport { CartPage } from './pages/cart.page';"),
            Glue.importInsertion(
                text,
                listOf("import { CartPage } from './pages/cart.page';", " import { CartPage } from './pages/cart.page'; ", "import { login } from './helpers';"),
            ),
        )
        assertEquals(null, Glue.importInsertion(text, listOf("import { expect } from \"@playwright/test\"", "")))
        assertEquals(null, Glue.importInsertion(text, emptyList()))
    }

    @Test
    fun `a name the file already imports is not imported again, whatever the path or the other names`() {
        val text = "import CartPage, { type Row as Line } from '../pages/cart.page.js';\nimport * as pages from './pages';\nimport Api = require('./api');\nimport './setup';\n"
        assertEquals(null, Glue.importInsertion(text, listOf("import { CartPage } from './pages/cart.page';")))
        assertEquals(null, Glue.importInsertion(text, listOf("import { Line } from './row';", "import { pages } from './pages';")))
        assertEquals(null, Glue.importInsertion(text, listOf("import './setup';")))
        val end = text.length - 1
        assertEquals(Glue.ImportInsertion(end, "\nimport { Row } from './row';\nimport './teardown';"), Glue.importInsertion(text, listOf("import { Row } from './row';", "import './teardown';")))
    }

    @Test
    fun `an import line whose names an import statement of the file binds already is left out`() {
        val text = "import {\n  CartPage,\n  LoginPage as Login,\n} from './pages';\nimport Checkout, * as helpers from './helpers';\n\ntest('t', async () => {});\n"
        val skipped = listOf(
            "import { CartPage } from './pages/cart.page';",
            "import { Login } from './x';",
            "import { Checkout } from './y';",
            "import { helpers } from './z';",
        )
        assertEquals(null, Glue.importInsertion(text, skipped))
        assertEquals(
            Glue.ImportInsertion(text.indexOf("\n\ntest"), "\nimport { LoginPage } from './pages/login.page';"),
            Glue.importInsertion(text, skipped + "import { LoginPage } from './pages/login.page';"),
        )
    }

    @Test
    fun `without an import, the imports go at the top, followed by an empty line`() {
        assertEquals(Glue.ImportInsertion(0, "import { a } from './a';\n\n"), Glue.importInsertion("test('t', async () => {});\n", listOf("import { a } from './a';")))
        assertEquals(Glue.ImportInsertion(0, "import { a } from './a';\n"), Glue.importInsertion("\ntest('t', async () => {});\n", listOf("import { a } from './a';")))
        // Neither a dynamic import nor `import.meta` is an import statement.
        assertEquals(Glue.ImportInsertion(0, "import { a } from './a';\n\n"), Glue.importInsertion("import('./x');\nimport.meta.url;\n", listOf("import { a } from './a';")))
    }

    @Test
    fun `the banner says what the recording does and offers what applies`() {
        assertEquals(
            Glue.RecordingBanner("Piwi: opening the browser to record into this file…", listOf(Glue.RecordingAction.STOP)),
            Glue.recordingBanner("starting", 0, edited = false, stopping = false, message = null),
        )
        assertEquals(
            Glue.RecordingBanner("Piwi is recording what you do in the browser · 1 step", listOf(Glue.RecordingAction.PAUSE, Glue.RecordingAction.STOP)),
            Glue.recordingBanner("recording", 1, edited = false, stopping = false, message = " "),
        )
        assertEquals(
            Glue.RecordingBanner("Piwi: recording paused · 3 steps · Paused in the browser.", listOf(Glue.RecordingAction.RESUME, Glue.RecordingAction.STOP)),
            Glue.recordingBanner("paused", 3, edited = false, stopping = false, message = "Paused in the browser."),
        )
        assertEquals(
            listOf(Glue.RecordingAction.RESUME, Glue.RecordingAction.KEEP_EDITS),
            Glue.recordingBanner("recording", 3, edited = true, stopping = false, message = null).actions,
        )
        assertEquals(
            Glue.RecordingBanner("Piwi: stopping the recording…", emptyList()),
            Glue.recordingBanner("recording", 3, edited = true, stopping = true, message = "ignored"),
        )
    }

    @Test
    fun `the end of a recording says what was written where, and the warnings to check`() {
        assertEquals("Recorded 6 steps into checkout.spec.ts.", Glue.recordingSummary(6, 0, "checkout.spec.ts", null))
        assertEquals(
            "The browser was closed. Recorded 1 step into a.spec.ts. 1 warning to check, on its line.",
            Glue.recordingSummary(1, 1, "a.spec.ts", "The browser was closed."),
        )
        assertEquals("Recorded 2 steps into a.spec.ts. 2 warnings to check, on their lines.", Glue.recordingSummary(2, 2, "a.spec.ts", ""))
        assertEquals("Nothing was recorded into a.spec.ts.", Glue.recordingSummary(0, 0, "a.spec.ts", null))
    }

    @Test
    fun `a new spec's name gets the spec extension it lacks`() {
        assertEquals("checkout.spec.ts", Glue.specFileName(" checkout "))
        assertEquals("checkout.test.ts", Glue.specFileName("checkout.test"))
        assertEquals("checkout.spec.js", Glue.specFileName("checkout.spec.js"))
        assertEquals("flow.mts", Glue.specFileName("flow.mts"))
        assertEquals("cart.page.spec.ts", Glue.specFileName("cart.page"))
        assertEquals(null, Glue.specFileName(""))
        assertEquals(null, Glue.specFileName("e2e/checkout"))
        assertEquals(null, Glue.specFileName("..\\checkout"))
        assertEquals(null, Glue.specFileName(".."))
    }
}
