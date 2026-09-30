package dev.piwitests.jetbrains

import com.intellij.codeInsight.hints.codeVision.DaemonBoundCodeVisionProvider
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.util.io.FileUtil
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import com.sun.net.httpserver.HttpServer
import org.eclipse.lsp4j.ClientCapabilities
import org.eclipse.lsp4j.InitializeParams
import org.eclipse.lsp4j.InitializedParams
import org.eclipse.lsp4j.MessageActionItem
import org.eclipse.lsp4j.MessageParams
import org.eclipse.lsp4j.PublishDiagnosticsParams
import org.eclipse.lsp4j.ShowMessageRequestParams
import org.eclipse.lsp4j.WorkspaceFolder
import org.eclipse.lsp4j.jsonrpc.services.JsonNotification
import org.eclipse.lsp4j.launch.LSPLauncher
import org.eclipse.lsp4j.services.LanguageClient
import java.io.File
import java.net.InetSocketAddress
import java.util.concurrent.CompletableFuture
import java.util.concurrent.TimeUnit

class PiwiPluginTest : BasePlatformTestCase() {
    fun testRegistersItsExtensionsAndActions() {
        assertTrue(LspServerSupportProvider.EP_NAME.extensionList.any { it is PiwiLspServerSupportProvider })
        val codeVision = DaemonBoundCodeVisionProvider.extensionPoint.extensionList
        assertTrue(codeVision.map { it.javaClass.name }.toString(), codeVision.any { it is PiwiCodeVisionProvider })
        assertTrue(StatusBarWidgetFactory.EP_NAME.extensionList.any { it is PiwiStatusBarWidgetFactory })
        assertTrue(
            com.intellij.openapi.options.Configurable.PROJECT_CONFIGURABLE.getExtensions(project)
                .any { it.instanceClass == PiwiConfigurable::class.java.name },
        )
        for (id in listOf("Piwi.Connect", "Piwi.Disconnect", "Piwi.OpenSettings", "Piwi.Refresh", "Piwi.RunTestsForFile", "Piwi.OpenInDashboard", "Piwi.CopyMcpConfiguration", "Piwi.RunSelection", "Piwi.PairPicker")) {
            assertNotNull(id, ActionManager.getInstance().getAction(id))
        }
    }

    /** A project's settings, which a repository may commit, only ever select the key saved for their own instance. */
    fun testTheApiKeyIsKeptPerInstance() {
        val service = project.getService(PiwiProjectService::class.java)
        try {
            service.saveCredentials("https://a.example/", "Shop", "pd_a")
            assertEquals(EditorCredentials("https://a.example", "pd_a", "Shop"), service.credentials())
            service.settings().serverUrl = "https://b.example"
            assertEquals(null, service.credentials().apiKey)
            service.saveCredentials("https://b.example", "Shop", "pd_b")
            service.settings().serverUrl = "https://a.example"
            assertEquals("pd_a", service.credentials().apiKey)
            service.disconnect()
            assertEquals(EditorCredentials(null, null, null), service.credentials())
            // The desktop app: a project only, no address and no key.
            service.saveCredentials("", "Shop", "pd_ignored")
            assertEquals(EditorCredentials(null, null, "Shop"), service.credentials())
            service.disconnect()
            assertFalse(service.hasApiKey("https://a.example"))
            assertTrue(service.hasApiKey("https://b.example"))
        } finally {
            service.saveCredentials("https://b.example", "", null)
            service.disconnect()
        }
    }

    /** Connect's requests: an instance with a login asks for a key, and the browser sign-in hands one over. */
    fun testSignsInWithTheBrowserAndListsTheProjects() {
        val started = mutableListOf<String>()
        var polls = 0
        val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        server.createContext("/") { exchange ->
            val body = exchange.requestBody.readBytes().toString(Charsets.UTF_8)
            val (status, answer) = when (exchange.requestURI.path) {
                "/api/projects/menu" ->
                    if (exchange.requestHeaders.getFirst("X-API-Key") == "pd_new") 200 to """{"items":[{"id":7,"name":"Acme Mugs"}]}"""
                    else 401 to "{}"
                "/api/extension/connect" -> {
                    started += body
                    200 to """{"deviceCode":"pdc_1","userCode":"BCDF-GHJK","verificationUrl":"http://x/extension/connect?code=BCDF-GHJK","interval":5,"expiresIn":600}"""
                }
                "/api/extension/connect/token" ->
                    200 to if (++polls == 1) """{"status":"pending"}""" else """{"status":"approved","apiKey":"pd_new","user":{"name":"Ada"}}"""
                else -> 404 to "{}"
            }
            val bytes = answer.toByteArray()
            exchange.sendResponseHeaders(status, bytes.size.toLong())
            exchange.responseBody.use { it.write(bytes) }
        }
        server.start()
        val url = "http://127.0.0.1:${server.address.port}"
        try {
            assertTrue(PiwiInstance.needsKey(url))
            val signIn = PiwiInstance.startSignIn(url, "WebStorm", "Linux")
            assertEquals("BCDF-GHJK", signIn.userCode)
            assertEquals(5, signIn.interval)
            assertEquals("""{"editor":"WebStorm","os":"Linux"}""", started.single())
            assertEquals("pending", PiwiInstance.pollSignIn(url, signIn.deviceCode).status)
            val approved = PiwiInstance.pollSignIn(url, signIn.deviceCode)
            assertEquals("approved", approved.status)
            assertEquals(listOf("Acme Mugs"), PiwiInstance.projects(url, approved.apiKey).map { it.name })
        } finally {
            server.stop(0)
        }
    }

    fun testCopyTextCopiesTheAgentContext() {
        PiwiCommands.execute(project, "piwi.copyText", listOf(com.google.gson.JsonPrimitive("# Failing test: pays")))
        val copied = com.intellij.openapi.ide.CopyPasteManager.getInstance()
            .getContents<String>(java.awt.datatransfer.DataFlavor.stringFlavor)
        assertEquals("# Failing test: pays", copied)
    }

    fun testServesTheFilesTheServiceReads() {
        for (name in listOf("Checkout.vue", "checkout.page.ts", "Index.cshtml", "Cart.razor", "Strings.resx", "en.json")) {
            assertTrue(name, PiwiLspServerSupportProvider.isSupported(myFixture.addFileToProject("src/$name", "").virtualFile))
        }
        assertFalse(PiwiLspServerSupportProvider.isSupported(myFixture.addFileToProject("src/logo.png", "").virtualFile))
    }

    /** Piwi Picker's request lands at the caret of the open editor, through the IDE's built-in server. */
    fun testPiwiPickerSendsALocatorToTheCaret() {
        myFixture.configureByText("checkout.spec.ts", "test('pays', async ({ page }) => {\n  <caret>\n});\n")
        val token = PiwiSendToken.ensure()
        val port = org.jetbrains.ide.BuiltInServerManager.getInstance().waitForStart().port
        val client = java.net.http.HttpClient.newHttpClient()
        fun post(body: String, bearer: String) = client.sendAsync(
            java.net.http.HttpRequest.newBuilder(java.net.URI("http://127.0.0.1:$port${PiwiSendHandler.PATH}"))
                .header("Authorization", "Bearer $bearer")
                .header("Origin", "chrome-extension://abc")
                .POST(java.net.http.HttpRequest.BodyPublishers.ofString(body))
                .build(),
            java.net.http.HttpResponse.BodyHandlers.ofString(),
        )
        fun await(future: CompletableFuture<java.net.http.HttpResponse<String>>): java.net.http.HttpResponse<String> {
            val deadline = System.currentTimeMillis() + 20_000
            while (!future.isDone && System.currentTimeMillis() < deadline) {
                com.intellij.testFramework.PlatformTestUtil.dispatchAllEventsInIdeEventQueue()
                Thread.sleep(20)
            }
            return future.get(1, TimeUnit.SECONDS)
        }

        assertEquals(401, await(post("""{"kind":"locator","text":"x"}""", "wrong-token-wrong-token")).statusCode())
        val bad = await(post("""{"kind":"file"}""", token))
        assertEquals(400, bad.statusCode())
        val ok = await(post("""{"kind":"locator","text":"page.getByRole('button', { name: 'Pay now' })"}""", token))
        assertEquals(ok.body(), 200, ok.statusCode())
        assertEquals("chrome-extension://abc", ok.headers().firstValue("Access-Control-Allow-Origin").orElse(null))
        assertEquals(
            "test('pays', async ({ page }) => {\n  page.getByRole('button', { name: 'Pay now' })\n});\n",
            myFixture.editor.document.text,
        )
    }

    /** The service the plugin bundles, started with the descriptor's command line, answers in the protocol classes. */
    fun testTheBundledServiceAnswersThroughTheDescriptor() {
        val stub = StubInstance()
        val dir = FileUtil.createTempDirectory("piwi-jetbrains", null, true)
        try {
            writeFixture(dir)
            val commandLine = PiwiLspServerDescriptor(project).createCommandLine()
                .withWorkDirectory(dir)
                .withEnvironment(
                    mapOf(
                        "PIWI_DASHBOARD_URL" to stub.url,
                        "PIWI_PROJECT_NAME" to "Acme Mugs",
                        "PIWI_DESKTOP_CONFIG" to File(dir, "no-desktop.json").path,
                    ),
                )
            val process = commandLine.createProcess()
            try {
                val client = TestClient()
                val launcher = LSPLauncher.Builder<PiwiLanguageServer>()
                    .setLocalService(client)
                    .setRemoteInterface(PiwiLanguageServer::class.java)
                    .setInput(process.inputStream)
                    .setOutput(process.outputStream)
                    .create()
                launcher.startListening()
                val server = launcher.remoteProxy
                server.initialize(
                    InitializeParams().apply {
                        capabilities = ClientCapabilities()
                        workspaceFolders = listOf(WorkspaceFolder(dir.toURI().toString(), "shop"))
                    },
                ).get(20, TimeUnit.SECONDS)
                server.initialized(InitializedParams())

                val deadline = System.currentTimeMillis() + 20_000
                var status: StatusResult? = null
                while (System.currentTimeMillis() < deadline) {
                    status = server.status().get(5, TimeUnit.SECONDS)
                    if (status?.contexts?.firstOrNull()?.connected == true) break
                    Thread.sleep(100)
                }
                assertEquals("Acme Mugs", status?.contexts?.single()?.projectName)

                // The latest run is read after the indexes: wait for it too.
                var runs: RunStatusResult? = null
                while (System.currentTimeMillis() < deadline) {
                    runs = server.runStatus().get(5, TimeUnit.SECONDS)
                    if (runs?.contexts?.firstOrNull()?.run != null) break
                    Thread.sleep(100)
                }
                assertEquals(41, runs?.contexts?.single()?.run?.id)
                assertEquals("Piwi: 1 failing", Glue.statusView(status, runs).text)

                // No desktop app runs here: Connect offers none.
                assertEquals(null, server.desktop().get(5, TimeUnit.SECONDS)?.url)

                val failure = server.failures().get(5, TimeUnit.SECONDS)?.items?.single()
                assertEquals(File(dir, "tests/pages/checkout.page.ts").toURI().toString().replace("file:/", "file:///"), failure?.uri)
                assertEquals(4, failure?.line)
                assertTrue(failure?.hasTrace == true)

                val pageObject = File(dir, "tests/pages/checkout.page.ts").toURI().toString().replace("file:/", "file:///")
                val summary = server.fileSummary(UriParams(pageObject)).get(5, TimeUnit.SECONDS)
                assertEquals(listOf(4 to "1 test · click · 1 failing"), summary?.lines?.map { it.line to it.title })
                assertEquals("piwi.runTests", summary?.lines?.single()?.command?.command)

                val mcp = server.mcp().get(5, TimeUnit.SECONDS)?.servers?.single()
                assertEquals("${stub.url}/mcp", mcp?.url)
                assertTrue(client.runStatusChanges > 0)
            } finally {
                process.destroy()
            }
        } finally {
            stub.stop()
        }
    }

    private fun writeFixture(dir: File) {
        fun write(path: String, text: String) = File(dir, path).apply { parentFile.mkdirs() }.writeText(text)
        write("playwright.config.ts", "export default {};\n")
        write(
            "tests/pages/checkout.page.ts",
            listOf(
                "import type { Page } from '@playwright/test';",
                "export class CheckoutPage {",
                "  constructor(private readonly page: Page) {}",
                "  pay = () => this.page.getByRole('button', { name: 'Pay now' });",
                "  row = () => this.page.locator('.cart-row').nth(2);",
                "}",
                "",
            ).joinToString("\n"),
        )
        write("tests/checkout.spec.ts", "import { test } from '@playwright/test';\n\ntest('pays', async ({ page }) => {});\n")
        fun git(vararg args: String) {
            val p = ProcessBuilder(listOf("git", "-c", "user.email=t@example.com", "-c", "user.name=t") + args)
                .directory(dir).redirectErrorStream(true).start()
            p.inputStream.readAllBytes()
            assertEquals(0, p.waitFor())
        }
        git("init", "-q", "-b", "main")
        git("add", ".")
        git("commit", "-q", "-m", "init")
    }

    class TestClient : LanguageClient {
        @Volatile var runStatusChanges = 0

        @JsonNotification("piwi/runStatusChanged")
        fun runStatusChanged(@Suppress("UNUSED_PARAMETER") status: RunStatusResult) {
            runStatusChanges++
        }

        override fun telemetryEvent(`object`: Any?) {}
        override fun publishDiagnostics(diagnostics: PublishDiagnosticsParams?) {}
        override fun showMessage(messageParams: MessageParams?) {}
        override fun showMessageRequest(requestParams: ShowMessageRequestParams?): CompletableFuture<MessageActionItem> =
            CompletableFuture.completedFuture(null)
        override fun logMessage(message: MessageParams?) {}
    }

    /** The instance endpoints the service reads, with one failing run. */
    class StubInstance {
        private val server = HttpServer.create(InetSocketAddress("127.0.0.1", 0), 0)
        val url get() = "http://127.0.0.1:${server.address.port}"

        init {
            val routes = mapOf(
                "/api/projects/menu" to """{"items":[{"id":7,"name":"Acme Mugs"}]}""",
                "/api/projects/7/locator-index" to """
                    {"projectId":7,"projectName":"Acme Mugs","branch":null,"defaultBranch":"main","branches":[],
                     "builtAt":null,"generatedAt":"2026-09-27T00:00:00Z","testIdAttributes":null,"pages":["/checkout"],
                     "tests":[{"id":3,"title":"removes a row","file":"tests/checkout.spec.ts","suite":[],"status":"failed"}],
                     "locators":[{"locator":"locator('.cart-row').nth(2)","lastSeenAt":"","uses":[{"test":0,"actions":["click"],
                       "callSites":["tests/pages/checkout.page.ts:5:21"],"projects":["chromium"],"branches":["main"]}]}],
                     "truncated":false}
                """.trimIndent(),
                "/api/projects/7/code-index" to """{"files":[],"tests":[],"reach":[],"builtAt":null,"truncated":false}""",
                "/api/projects/7/branch-failures" to """
                    {"run":{"id":41,"status":"failed","branch":"main","startTime":"2026-09-27T10:00:00.000Z","totalTests":2,
                      "passedTests":1,"failedTests":1,"flakyTests":0,"skippedTests":0},
                     "failures":[{"executionId":900,"testCaseId":3,"title":"removes a row","file":"tests/checkout.spec.ts",
                      "line":3,"status":"failed","headline":"not found","location":"/ci/work/tests/pages/checkout.page.ts:5:21",
                      "traces":["traces/900.zip"],"screenshot":null}]}
                """.trimIndent(),
                "/api/projects/7/test-cases" to """{"items":[]}""",
                "/api/projects/7/locator-alternatives" to """{"items":[]}""",
            )
            server.createContext("/") { exchange ->
                val body = routes[exchange.requestURI.path]
                val bytes = (body ?: "{}").toByteArray()
                exchange.responseHeaders.add("Content-Type", "application/json")
                exchange.sendResponseHeaders(if (body != null) 200 else 404, bytes.size.toLong())
                exchange.responseBody.use { it.write(bytes) }
            }
            server.start()
        }

        fun stop() = server.stop(0)
    }
}
