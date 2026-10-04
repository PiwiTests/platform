package dev.piwitests.jetbrains

import com.intellij.platform.lsp.api.LspServer
import org.eclipse.lsp4j.services.LanguageServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import java.lang.reflect.Proxy
import java.util.concurrent.CompletableFuture

/** The service's lsp4j proxy is taken from a request's sender, once per server, and only while the service runs. */
class Lsp4jAccessTest {
    private val proxy = Proxy.newProxyInstance(javaClass.classLoader, arrayOf(PiwiLanguageServer::class.java)) { _, _, _ -> null }
        as PiwiLanguageServer

    /** An `LspServer` whose `sendRequestSync` runs the sender on another thread and waits, as the platform does. */
    private fun server(running: Boolean, requests: IntArray): LspServer =
        Proxy.newProxyInstance(javaClass.classLoader, arrayOf(LspServer::class.java)) { self, method, args ->
            when (method.name) {
                "sendRequestSync" -> {
                    requests[0]++
                    @Suppress("UNCHECKED_CAST")
                    val sender = args!![1] as (LanguageServer) -> CompletableFuture<Any?>
                    if (running) CompletableFuture.supplyAsync { sender(proxy) }.get().get() else null
                }
                "hashCode" -> System.identityHashCode(self)
                "equals" -> self === args!![0]
                else -> null
            }
        } as LspServer

    @Test
    fun `takes the proxy from a request that sends nothing, once per server`() {
        val requests = IntArray(1)
        val running = server(running = true, requests)
        assertSame(proxy, Lsp4jAccess.server(running))
        assertSame(proxy, Lsp4jAccess.server(running))
        assertEquals(1, requests[0])
    }

    @Test
    fun `has none while the service does not run`() {
        val requests = IntArray(1)
        val starting = server(running = false, requests)
        assertNull(Lsp4jAccess.server(starting))
        assertNull(Lsp4jAccess.server(starting))
        assertEquals(2, requests[0])
    }
}
