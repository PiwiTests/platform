package dev.piwitests.jetbrains

import com.intellij.openapi.components.service
import com.intellij.openapi.util.io.FileUtil
import com.intellij.testFramework.fixtures.BasePlatformTestCase
import java.io.File

class PiwiOpenHandlerTest : BasePlatformTestCase() {
    fun testOpensFilesOnlyForTheInstanceAProjectIsConnectedTo() = withHome(desktopJson = null) {
        val settings = project.service<PiwiSettings>().state
        val saved = settings.serverUrl
        val handler = PiwiOpenHandler()
        try {
            settings.serverUrl = ""
            assertFalse("no instance named, nothing is trusted", handler.trusts("https://piwi.example.com"))

            settings.serverUrl = "https://piwi.example.com"
            assertTrue(handler.trusts("https://piwi.example.com"))
            assertFalse("another site", handler.trusts("https://evil.example"))
            assertFalse("a page on this machine", handler.trusts("http://localhost:5173"))
            assertFalse("a request without an origin", handler.trusts(null))
            assertFalse("a local file or a sandboxed frame", handler.trusts("null"))

            settings.serverUrl = "http://localhost:3000"
            assertTrue("the same server under another loopback name", handler.trusts("http://127.0.0.1:3000"))
            assertFalse("another server on this machine", handler.trusts("http://127.0.0.1:3001"))
        } finally {
            settings.serverUrl = saved
        }
    }

    fun testOpensFilesForTheDesktopApp() {
        // PIWI_DESKTOP_CONFIG names another discovery file than the home folder's.
        if (!System.getenv("PIWI_DESKTOP_CONFIG").isNullOrBlank()) return
        val handler = PiwiOpenHandler()
        withHome(desktopJson = """{"url":"http://127.0.0.1:41234/","token":"t"}""") {
            assertTrue(handler.trusts("http://127.0.0.1:41234"))
            assertTrue("the same server under another loopback name", handler.trusts("http://localhost:41234"))
            assertFalse("another server on this machine", handler.trusts("http://127.0.0.1:41235"))
        }
        withHome(desktopJson = null) {
            assertFalse("the desktop app does not run", handler.trusts("http://127.0.0.1:41234"))
        }
    }

    /** Runs [block] with a home folder that holds [desktopJson] as the desktop app's discovery file, or none. */
    private fun withHome(desktopJson: String?, block: () -> Unit) {
        val home = FileUtil.createTempDirectory("piwi-home", null)
        if (desktopJson != null) File(home, ".piwi").apply { mkdirs() }.resolve("desktop.json").writeText(desktopJson)
        val saved = System.getProperty("user.home")
        System.setProperty("user.home", home.path)
        try {
            block()
        } finally {
            System.setProperty("user.home", saved)
        }
    }
}
