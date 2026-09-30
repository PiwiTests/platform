package dev.piwitests.jetbrains

import com.intellij.execution.ExecutionException
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.javascript.nodejs.interpreter.NodeJsInterpreterManager
import com.intellij.javascript.nodejs.interpreter.local.NodeJsLocalInterpreter
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.components.service
import com.intellij.openapi.diagnostic.ControlFlowException
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.IconLoader
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.Lsp4jClient
import com.intellij.platform.lsp.api.LspServer
import com.intellij.platform.lsp.api.LspServerNotificationsHandler
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor
import com.intellij.platform.lsp.api.customization.LspCommandsSupport
import com.intellij.platform.lsp.api.lsWidget.LspServerWidgetItem
import org.eclipse.lsp4j.Command
import org.eclipse.lsp4j.InitializeParams
import org.eclipse.lsp4j.WorkspaceFolder
import org.eclipse.lsp4j.jsonrpc.services.JsonNotification
import org.eclipse.lsp4j.services.LanguageServer
import java.lang.ref.WeakReference
import java.lang.reflect.InvocationTargetException
import java.lang.reflect.Method
import java.nio.file.Files
import java.nio.file.Path
import java.util.Collections
import java.util.WeakHashMap
import java.util.concurrent.CompletableFuture

/**
 * Starts the editor service for projects that hold a Playwright config, on the files it reads.
 * Until the search for configs started with the project ends, it starts nothing: the search
 * starts the service for the files already open.
 */
class PiwiLspServerSupportProvider : LspServerSupportProvider {
    override fun fileOpened(project: Project, file: VirtualFile, serverStarter: LspServerSupportProvider.LspServerStarter) {
        if (!isSupported(file) || !project.service<PiwiProjectService>().hasPlaywrightConfig()) return
        serverStarter.ensureServerStarted(PiwiLspServerDescriptor(project))
    }

    /**
     * The service's entry in the Language Services widget (2024.1 and later): Piwi's icon, and
     * the gear that opens **Settings → Tools → Piwi**. The platform calls it through the
     * interface method of the same signature; the oldest supported platform has no widget, and
     * no such method to override.
     */
    @Suppress("unused")
    fun createLspServerWidgetItem(lspServer: LspServer, currentFile: VirtualFile?): LspServerWidgetItem =
        LspServerWidgetItem(lspServer, currentFile, ICON, PiwiConfigurable::class.java)

    companion object {
        private val ICON = IconLoader.getIcon("/icons/piwi.svg", PiwiLspServerSupportProvider::class.java)

        fun isSupported(file: VirtualFile): Boolean =
            file.isInLocalFileSystem && (file.extension?.lowercase() ?: "") in Glue.SUPPORTED_EXTENSIONS
    }
}

class PiwiLspServerDescriptor(project: Project) : ProjectWideLspServerDescriptor(project, "Piwi") {
    override fun isSupportedFile(file: VirtualFile): Boolean = PiwiLspServerSupportProvider.isSupported(file)

    override fun createCommandLine(): GeneralCommandLine {
        val server = serverBundle()
        if (!Files.isRegularFile(server)) throw ExecutionException("The Piwi editor service is missing: $server")
        val interpreter = NodeJsInterpreterManager.getInstance(project).interpreter
        val node = (interpreter as? NodeJsLocalInterpreter)?.interpreterSystemDependentPath ?: "node"
        val folder = project.service<PiwiProjectService>().searchRoots().firstOrNull()?.toString() ?: project.basePath
        return GeneralCommandLine(node, server.toString(), "--stdio")
            .withWorkDirectory(folder)
            .withCharset(Charsets.UTF_8)
    }

    /** The workspace is the folders the plugin searched for Playwright configs: the service searches them again. */
    override fun createInitializeParams(): InitializeParams = super.createInitializeParams().apply {
        val roots = project.service<PiwiProjectService>().searchRoots()
        if (roots.isEmpty()) return@apply
        val files = LocalFileSystem.getInstance()
        workspaceFolders = roots.map { root ->
            val uri = files.findFileByNioFile(root)?.let { getFileUri(it) } ?: root.toUri().toString()
            WorkspaceFolder(uri, root.fileName?.toString() ?: root.toString())
        }
    }

    /**
     * The service bundle: `server/` beside the plugin's `lib/`, or the path the
     * `piwi.editor.server` system property names (the tests set it).
     */
    private fun serverBundle(): Path {
        System.getProperty("piwi.editor.server")?.let { return Path.of(it) }
        val jar = PathManager.getJarPathForClass(PiwiLspServerDescriptor::class.java)
            ?: throw ExecutionException("The Piwi plugin's location is unknown")
        return Path.of(jar).parent.parent.resolve("server").resolve("piwi-language-server.cjs")
    }

    override fun createInitializationOptions(): Any =
        mapOf("credentials" to project.service<PiwiProjectService>().credentials())

    override val lsp4jServerClass: Class<out org.eclipse.lsp4j.services.LanguageServer> = PiwiLanguageServer::class.java

    override fun createLsp4jClient(handler: LspServerNotificationsHandler): Lsp4jClient = PiwiLsp4jClient(handler, project)

    override val lspCommandsSupport: LspCommandsSupport = object : LspCommandsSupport() {
        override fun executeCommand(server: LspServer, contextFile: VirtualFile, command: Command) {
            PiwiCommands.execute(project, command.command, command.arguments.orEmpty())
        }
    }
}

/** The lsp4j proxy of a running service, with the service's own requests; null until it runs. */
fun LspServer.piwiServer(): PiwiLanguageServer? = Lsp4jAccess.server(this) as? PiwiLanguageServer

/**
 * The lsp4j proxy of a running service, found at run time: no one accessor is declared on every
 * supported platform. Up to 2024.x, `getLsp4jServer()` hands it out; later platforms only pass it
 * to a request, so it is taken from a `sendRequestSync` that sends nothing. Kept per server.
 */
object Lsp4jAccess {
    private val found = Collections.synchronizedMap(WeakHashMap<Any, WeakReference<LanguageServer>>())

    fun server(client: Any): LanguageServer? {
        found[client]?.get()?.let { return it }
        val server = accessor(client) ?: fromRequest(client) ?: return null
        found[client] = WeakReference(server)
        return server
    }

    private fun accessor(client: Any): LanguageServer? =
        method(client, "getLsp4jServer")?.let { runCatching { it.invoke(client) as? LanguageServer }.getOrNull() }

    private fun fromRequest(client: Any): LanguageServer? {
        val send = method(client, "sendRequestSync", Int::class.javaPrimitiveType!!, Function1::class.java) ?: return null
        var captured: LanguageServer? = null
        val sender: (LanguageServer) -> CompletableFuture<Any?> = {
            captured = it
            CompletableFuture.completedFuture(null)
        }
        // The platform runs the sender only while the service runs, and waits for it.
        try {
            send.invoke(client, 1_000, sender)
        } catch (e: InvocationTargetException) {
            (e.cause as? ControlFlowException)?.let { throw it as Throwable }
        } catch (_: ReflectiveOperationException) {
        }
        return captured
    }

    /** A public method of the client's interfaces: its implementation class is the platform's own. */
    private fun method(client: Any, name: String, vararg parameters: Class<*>): Method? {
        val interfaces = LinkedHashSet<Class<*>>()
        fun collect(type: Class<*>?) {
            if (type == null) return
            for (i in type.interfaces) if (interfaces.add(i)) collect(i)
            collect(type.superclass)
        }
        collect(client.javaClass)
        return interfaces.firstNotNullOfOrNull { runCatching { it.getMethod(name, *parameters) }.getOrNull() }
    }
}

/** Receives the service's notifications beside the protocol's. */
class PiwiLsp4jClient(handler: LspServerNotificationsHandler, private val project: Project) : Lsp4jClient(handler) {
    @JsonNotification("piwi/runStatusChanged")
    fun runStatusChanged(@Suppress("UNUSED_PARAMETER") status: RunStatusResult) {
        project.service<PiwiProjectService>().refreshStatus()
    }

    @JsonNotification("piwi/statusChanged")
    fun statusChanged(@Suppress("UNUSED_PARAMETER") status: StatusResult) {
        project.service<PiwiProjectService>().refreshStatus()
    }
}
