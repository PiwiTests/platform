package dev.piwitests.jetbrains

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class OpenOriginsTest {
    @Test
    fun `an origin is the scheme, the host and a port other than the default, in lower case`() {
        assertEquals("https://piwi.example.com", OpenOrigins.originOf("https://piwi.example.com"))
        assertEquals("https://piwi.example.com", OpenOrigins.originOf(" HTTPS://Piwi.Example.com:443/projects/7?x=1 "))
        assertEquals("http://piwi.example.com", OpenOrigins.originOf("http://piwi.example.com:80/"))
        assertEquals("http://piwi.example.com:8080", OpenOrigins.originOf("http://piwi.example.com:8080"))
        assertEquals("https://piwi.example.com:80", OpenOrigins.originOf("https://piwi.example.com:80"))
        assertEquals("http://[::1]:3000", OpenOrigins.originOf("http://[::1]:3000"))
    }

    @Test
    fun `anything but an http or https address has no origin`() {
        assertNull(OpenOrigins.originOf(null))
        assertNull(OpenOrigins.originOf(""))
        assertNull(OpenOrigins.originOf("null"))
        assertNull(OpenOrigins.originOf("file:///home/me/report.html"))
        assertNull(OpenOrigins.originOf("chrome-extension://abcdef"))
        assertNull(OpenOrigins.originOf("http://"))
        assertNull(OpenOrigins.originOf("not a url"))
    }

    @Test
    fun `an address on this machine allows its other loopback names, on its port only`() {
        val allowed = OpenOrigins.allowed(listOf("http://localhost:3000/"))
        assertEquals(setOf("http://localhost:3000", "http://127.0.0.1:3000", "http://[::1]:3000"), allowed)
        assertTrue(OpenOrigins.isAllowed("http://127.0.0.1:3000", allowed))
        assertFalse(OpenOrigins.isAllowed("http://127.0.0.1:3001", allowed))
        assertFalse(OpenOrigins.isAllowed("https://localhost:3000", allowed))
        assertEquals(
            setOf("http://[::1]", "http://localhost", "http://127.0.0.1"),
            OpenOrigins.allowed(listOf("http://[::1]:80/")),
        )
    }

    @Test
    fun `an instance allows its own origin and nothing that only looks like it`() {
        val allowed = OpenOrigins.allowed(listOf("https://piwi.example.com/piwi", null, " ", "http://127.0.0.1:41234"))
        assertTrue(OpenOrigins.isAllowed("https://piwi.example.com", allowed))
        assertTrue(OpenOrigins.isAllowed("http://localhost:41234", allowed))
        assertFalse(OpenOrigins.isAllowed("https://evil.piwi.example.com", allowed))
        assertFalse(OpenOrigins.isAllowed("https://piwi.example.com.evil.net", allowed))
        assertFalse(OpenOrigins.isAllowed("http://piwi.example.com", allowed))
        assertFalse(OpenOrigins.isAllowed("https://piwi.example.com:8443", allowed))
        assertFalse(OpenOrigins.isAllowed("http://localhost:5173", allowed))
    }

    @Test
    fun `a request without an origin, or with the null one, is never allowed`() {
        val allowed = OpenOrigins.allowed(listOf("http://localhost:3000"))
        assertFalse(OpenOrigins.isAllowed(null, allowed))
        assertFalse(OpenOrigins.isAllowed("", allowed))
        assertFalse(OpenOrigins.isAllowed("null", allowed))
        assertFalse(OpenOrigins.isAllowed("https://piwi.example.com", emptySet()))
    }

    @Test
    fun `an instance reaches the projects connected to it, the desktop app every project`() {
        val byProject = linkedMapOf(
            "shop" to listOf<String?>("https://piwi.example.com", null),
            "admin" to listOf<String?>("https://piwi.other.com"),
            "docs" to listOf<String?>("http://localhost:3000"),
        )
        val everywhere = listOf<String?>("http://127.0.0.1:41234")
        assertEquals(listOf("shop"), OpenOrigins.projectsFor("https://piwi.example.com", everywhere, byProject))
        assertEquals(listOf("docs"), OpenOrigins.projectsFor("http://127.0.0.1:3000", everywhere, byProject))
        assertEquals(listOf("shop", "admin", "docs"), OpenOrigins.projectsFor("http://localhost:41234", everywhere, byProject))
        assertEquals(emptyList<String>(), OpenOrigins.projectsFor("https://evil.example", everywhere, byProject))
        assertEquals(emptyList<String>(), OpenOrigins.projectsFor(null, everywhere, byProject))
    }

    @Test
    fun `reads the instance a workspace env file names, as the editor service reads it`() {
        assertEquals("https://piwi.example.com", OpenOrigins.dashboardUrlFromDotEnv("PIWI_DASHBOARD_URL=https://piwi.example.com"))
        assertEquals(
            "https://b.example.com",
            OpenOrigins.dashboardUrlFromDotEnv(
                "# Piwi\nexport PIWI_DASHBOARD_URL=\"https://a.example.com\"\r\nPIWI_API_KEY=pd_x\nPIWI_DASHBOARD_URL='https://b.example.com'\n",
            ),
        )
        assertEquals("http://localhost:3000", OpenOrigins.dashboardUrlFromDotEnv("PIWI_DASHBOARD_URL = http://localhost:3000   # local"))
        assertNull(OpenOrigins.dashboardUrlFromDotEnv("PIWI_API_KEY=pd_x"))
        assertNull(OpenOrigins.dashboardUrlFromDotEnv("PIWI_DASHBOARD_URL="))
        assertNull(OpenOrigins.dashboardUrlFromDotEnv(null))
    }
}
