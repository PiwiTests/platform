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

/**
 * The instance and project this project reports to, when the environment, `.env` and the
 * desktop app name none: **Settings → Tools → Piwi**, kept in `.idea/piwi.xml`. The key
 * is not here but in the password safe, per instance.
 */
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
        val found = playwrightConfigDirs().isNotEmpty()
        playwrightConfig = found
        return found
    }

    /** The directories holding a Playwright config, up to four levels down: where a run's file paths start. */
    fun playwrightConfigDirs(): List<VirtualFile> {
        val root = project.guessProjectDir() ?: return emptyList()
        return mutableListOf<VirtualFile>().also { collectConfigDirs(root, 0, it) }
    }

    private fun collectConfigDirs(dir: VirtualFile, depth: Int, found: MutableList<VirtualFile>) {
        val children = dir.children ?: return
        if (children.any { !it.isDirectory && it.name in Glue.PLAYWRIGHT_CONFIGS }) found += dir
        if (depth >= 4) return
        for (child in children) {
            if (child.isDirectory && !child.name.startsWith(".") && child.name !in SKIP_DIRS) collectConfigDirs(child, depth + 1, found)
        }
    }

    fun settings(): PiwiSettings.State = project.getService(PiwiSettings::class.java).state

    /** The connection saved in the IDE: this project's instance and project, and that instance's key. */
    fun credentials(): EditorCredentials {
        forgetSharedKey()
        val settings = settings()
        val url = settings.serverUrl.ifBlank { null }
        return EditorCredentials(
            serverUrl = url,
            project = settings.project.ifBlank { null },
            apiKey = url?.let { PasswordSafe.instance.getPassword(credentialAttributes(it)) },
        )
    }

    /** Whether the password safe holds a key for the instance. */
    fun hasApiKey(serverUrl: String): Boolean =
        serverUrl.isNotBlank() && !PasswordSafe.instance.getPassword(credentialAttributes(serverUrl)).isNullOrEmpty()

    /** Save the connection, and hand it to the service; a null key forgets the instance's key. */
    fun saveCredentials(serverUrl: String, projectName: String, apiKey: String?) {
        val url = Glue.normalizeServerUrl(serverUrl) ?: serverUrl.trim()
        val settings = settings()
        settings.serverUrl = url
        settings.project = projectName.trim()
        // No address: the desktop app, whose token the service reads from its discovery file.
        if (url.isNotBlank()) PasswordSafe.instance.setPassword(credentialAttributes(url), apiKey?.trim()?.ifBlank { null })
        sendCredentials()
    }

    /** Forget this project's instance and project, and that instance's key. */
    fun disconnect() {
        val settings = settings()
        if (settings.serverUrl.isNotBlank()) PasswordSafe.instance.setPassword(credentialAttributes(settings.serverUrl), null)
        settings.serverUrl = ""
        settings.project = ""
        sendCredentials()
    }

    /**
     * Hand the connection to the running service (`piwi/setCredentials`) and read the
     * status again once it has used it; without a service, start it for the open files.
     */
    fun sendCredentials() {
        ApplicationManager.getApplication().executeOnPooledThread {
            val manager = LspServerManager.getInstance(project)
            val lsp = manager.getServersForProvider(PiwiLspServerSupportProvider::class.java)
            if (lsp.isEmpty()) {
                manager.startServersIfNeeded(PiwiLspServerSupportProvider::class.java)
            } else {
                val credentials = credentials()
                lsp.forEach { it.piwiServer()?.setCredentials(credentials) }
                server()?.refresh()?.orNull()
            }
            refreshStatus()
        }
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

    private fun credentialAttributes(serverUrl: String) =
        CredentialAttributes(generateServiceName("Piwi", Glue.apiKeyEntry(serverUrl)))

    /**
     * Deletes the key shared by every instance, once: a project naming another
     * instance would send it there. Connect again to save a key per instance.
     */
    private fun forgetSharedKey() {
        val properties = com.intellij.ide.util.PropertiesComponent.getInstance()
        if (properties.getBoolean(SHARED_KEY_FORGOTTEN)) return
        properties.setValue(SHARED_KEY_FORGOTTEN, true)
        PasswordSafe.instance.setPassword(CredentialAttributes(generateServiceName("Piwi", "apiKey")), null)
    }

    companion object {
        private val SKIP_DIRS = setOf("node_modules", "dist", "build", "coverage", "test-results")
        const val TIMEOUT_SECONDS = 20L
        private const val SHARED_KEY_FORGOTTEN = "piwi.sharedKeyForgotten"
    }
}

/** The answer of a service request, or null when it failed or took too long. */
fun <T> java.util.concurrent.CompletableFuture<T>.orNull(): T? =
    try {
        get(PiwiProjectService.TIMEOUT_SECONDS, TimeUnit.SECONDS)
    } catch (_: Exception) {
        null
    }
