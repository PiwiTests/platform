package dev.piwitests.jetbrains

import com.intellij.execution.ExecutionException
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.javascript.nodejs.interpreter.NodeJsInterpreterManager
import com.intellij.javascript.nodejs.interpreter.local.NodeJsLocalInterpreter
import com.intellij.openapi.application.PathManager
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.Lsp4jClient
import com.intellij.platform.lsp.api.LspServer
import com.intellij.platform.lsp.api.LspServerNotificationsHandler
import com.intellij.platform.lsp.api.LspServerSupportProvider
import com.intellij.platform.lsp.api.ProjectWideLspServerDescriptor
import com.intellij.platform.lsp.api.customization.LspCommandsSupport
import org.eclipse.lsp4j.Command
import org.eclipse.lsp4j.jsonrpc.services.JsonNotification
import java.nio.file.Files
import java.nio.file.Path

/** Starts the editor service for projects that hold a Playwright config, on the files it reads. */
class PiwiLspServerSupportProvider : LspServerSupportProvider {
    override fun fileOpened(project: Project, file: VirtualFile, serverStarter: LspServerSupportProvider.LspServerStarter) {
        if (!isSupported(file) || !project.service<PiwiProjectService>().hasPlaywrightConfig()) return
        serverStarter.ensureServerStarted(PiwiLspServerDescriptor(project))
    }

    companion object {
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
        return GeneralCommandLine(node, server.toString(), "--stdio")
            .withWorkDirectory(project.basePath)
            .withCharset(Charsets.UTF_8)
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

/**
 * The lsp4j proxy of a running service. The accessor is declared on `LspServer` in
 * the oldest supported platform and on a super-interface of it in later ones, so it
 * is looked up at run time.
 */
fun LspServer.piwiServer(): PiwiLanguageServer? =
    try {
        LspServer::class.java.getMethod("getLsp4jServer").invoke(this) as? PiwiLanguageServer
    } catch (_: ReflectiveOperationException) {
        null
    }

/** Receives the service's notifications beside the protocol's. */
class PiwiLsp4jClient(handler: LspServerNotificationsHandler, private val project: Project) : Lsp4jClient(handler) {
    @JsonNotification("piwi/runStatusChanged")
    fun runStatusChanged(@Suppress("UNUSED_PARAMETER") status: RunStatusResult) {
        project.service<PiwiProjectService>().refreshStatus()
    }
}
