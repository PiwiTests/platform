package dev.piwitests.jetbrains

import com.intellij.openapi.components.service
import com.intellij.testFramework.fixtures.BasePlatformTestCase

class PiwiOpenHandlerTest : BasePlatformTestCase() {
    fun testOpensFilesOnlyForTheInstanceAProjectIsConnectedTo() {
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
}
