package dev.piwitests.jetbrains

import org.eclipse.lsp4j.services.LanguageServer
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import java.lang.reflect.Proxy
import java.util.concurrent.CompletableFuture

/** The service's lsp4j proxy is found on the platforms that hand it out, and on those that only pass it to a request. */
class Lsp4jAccessTest {
    /** How the oldest supported platforms declare the accessor. */
    interface OldClient {
        fun getLsp4jServer(): LanguageServer
    }

    /** How the latest ones declare the synchronous request: its sender receives the proxy. */
    interface NewClient {
        fun <T> sendRequestSync(timeout: Int, sender: (LanguageServer) -> CompletableFuture<T>): T?
    }

    private val proxy = Proxy.newProxyInstance(javaClass.classLoader, arrayOf(PiwiLanguageServer::class.java)) { _, _, _ -> null }
        as PiwiLanguageServer

    @Test
    fun `takes the proxy from the accessor where it is declared`() {
        val client = object : OldClient {
            override fun getLsp4jServer(): LanguageServer = proxy
        }
        assertSame(proxy, Lsp4jAccess.server(client))
    }

    @Test
    fun `takes the proxy from a request that sends nothing, once per client`() {
        var requests = 0
        val client = object : NewClient {
            // As the platform does: the sender runs on its executor, and the call waits for it.
            override fun <T> sendRequestSync(timeout: Int, sender: (LanguageServer) -> CompletableFuture<T>): T? {
                requests++
                return CompletableFuture.supplyAsync { sender(proxy) }.get().get()
            }
        }
        assertSame(proxy, Lsp4jAccess.server(client))
        assertSame(proxy, Lsp4jAccess.server(client))
        assertEquals(1, requests)
    }

    @Test
    fun `has none while the service does not run`() {
        val starting = object : NewClient {
            override fun <T> sendRequestSync(timeout: Int, sender: (LanguageServer) -> CompletableFuture<T>): T? = null
        }
        assertNull(Lsp4jAccess.server(starting))
        assertNull(Lsp4jAccess.server(Any()))
    }
}
