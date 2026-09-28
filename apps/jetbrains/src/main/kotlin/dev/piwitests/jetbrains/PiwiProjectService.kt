package dev.piwitests.jetbrains

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.generateServiceName
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServerManager
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit

/** The instance and project this project reports to, when the environment, `.env` and the desktop app name none. */
@Service(Service.Level.PROJECT)
@State(name = "PiwiSettings", storages = [Storage("piwi.xml")])
class PiwiSettings : PersistentStateComponent<PiwiSettings.State> {
    data class State(var serverUrl: String = "", var project: String = "")

    private var state = State()

    override fun getState(): State = state

    override fun loadState(state: State) {
        this.state = state
    }
}

/**
 * The plugin's state for one project: the connection it hands the editor
 * service, and the service's last answers on the run, which the status bar
 * and the failures tool window render.
 */
@Service(Service.Level.PROJECT)
class PiwiProjectService(private val project: Project) : Disposable {
    @Volatile var status: StatusResult? = null
        private set

    @Volatile var runs: RunStatusResult? = null
        private set

    @Volatile var failures: List<WorkspaceFailure> = emptyList()
        private set

    private val listeners = CopyOnWriteArrayList<() -> Unit>()
    private var playwrightConfig: Boolean? = null

    /** Called on the event thread after each refresh of the status. */
    fun onChange(parent: Disposable, listener: () -> Unit) {
        listeners += listener
        com.intellij.openapi.util.Disposer.register(parent) { listeners -= listener }
    }

    /** Whether a Playwright config sits in the project, up to four directory levels down. */
    fun hasPlaywrightConfig(): Boolean {
        playwrightConfig?.let { return it }
        val root = project.guessProjectDir() ?: return false
        val found = findConfig(root, 0)
        playwrightConfig = found
        return found
    }

    private fun findConfig(dir: VirtualFile, depth: Int): Boolean {
        val children = dir.children ?: return false
        if (children.any { !it.isDirectory && it.name in Glue.PLAYWRIGHT_CONFIGS }) return true
        if (depth >= 4) return false
        return children.any {
            it.isDirectory && !it.name.startsWith(".") && it.name !in SKIP_DIRS && findConfig(it, depth + 1)
        }
    }

    fun credentials(): EditorCredentials {
        val settings = project.getService(PiwiSettings::class.java).state
        return EditorCredentials(
            serverUrl = settings.serverUrl.ifBlank { null },
            project = settings.project.ifBlank { null },
            apiKey = PasswordSafe.instance.getPassword(credentialAttributes()),
        )
    }

    fun saveCredentials(serverUrl: String, projectName: String, apiKey: String?) {
        val settings = project.getService(PiwiSettings::class.java).state
        settings.serverUrl = serverUrl
        settings.project = projectName
        PasswordSafe.instance.setPassword(credentialAttributes(), apiKey?.ifBlank { null })
        sendCredentials()
    }

    /** Hand the connection to a running service (`piwi/setCredentials`). */
    fun sendCredentials() {
        val lsp = LspServerManager.getInstance(project).getServersForProvider(PiwiLspServerSupportProvider::class.java)
        if (lsp.isEmpty()) {
            LspServerManager.getInstance(project).stopAndRestartIfNeeded(PiwiLspServerSupportProvider::class.java)
            return
        }
        lsp.forEach { it.piwiServer()?.setCredentials(credentials()) }
    }

    /** The running editor service, if any. */
    fun server(): PiwiLanguageServer? =
        LspServerManager.getInstance(project).getServersForProvider(PiwiLspServerSupportProvider::class.java)
            .firstOrNull()?.piwiServer()

    /** Read the status, the latest run and its failures again, then tell the listeners. */
    fun refreshStatus() {
        ApplicationManager.getApplication().executeOnPooledThread {
            val server = server()
            status = server?.status()?.orNull()
            runs = server?.runStatus()?.orNull()
            failures = server?.failures()?.orNull()?.items.orEmpty()
            ApplicationManager.getApplication().invokeLater({ listeners.forEach { it() } }, project.disposed)
        }
    }

    override fun dispose() {
        listeners.clear()
    }

    private fun credentialAttributes() = CredentialAttributes(generateServiceName("Piwi", "apiKey"))

    companion object {
        private val SKIP_DIRS = setOf("node_modules", "dist", "build", "coverage", "test-results")
        const val TIMEOUT_SECONDS = 20L
    }
}

/** The answer of a service request, or null when it failed or took too long. */
fun <T> java.util.concurrent.CompletableFuture<T>.orNull(): T? =
    try {
        get(PiwiProjectService.TIMEOUT_SECONDS, TimeUnit.SECONDS)
    } catch (_: Exception) {
        null
    }
