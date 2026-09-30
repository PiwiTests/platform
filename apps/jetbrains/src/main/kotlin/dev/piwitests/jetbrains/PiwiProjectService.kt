package dev.piwitests.jetbrains

import com.intellij.credentialStore.CredentialAttributes
import com.intellij.credentialStore.generateServiceName
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ReadAction
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.service
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.project.BaseProjectDirectories.Companion.getBaseDirectories
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.openapi.wm.impl.status.widget.StatusBarWidgetsManager
import com.intellij.platform.lsp.api.LspServerManager
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

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

    /** The project's Playwright configs; null until the first search ends. */
    @Volatile private var playwright: Glue.PlaywrightSearch? = null

    /** Called on the event thread after each refresh of the status. */
    fun onChange(parent: Disposable, listener: () -> Unit) {
        listeners += listener
        com.intellij.openapi.util.Disposer.register(parent) { listeners -= listener }
    }

    /** Whether a Playwright config sits in the project; false until the search started with the project ends. */
    fun hasPlaywrightConfig(): Boolean = playwright?.configDirs.orEmpty().isNotEmpty()

    /** The directories holding a Playwright config: where a run's file paths start. */
    fun playwrightConfigDirs(): List<Path> = playwright?.configDirs.orEmpty()

    /** The folders searched for Playwright configs: the editor service's workspace. */
    fun searchRoots(): List<Path> = playwright?.roots.orEmpty()

    /**
     * Search the project's folders for Playwright configs, on the calling thread, and keep the answer:
     * the project folder (above `.idea` in Rider), the folder the IDE guesses and its base directories.
     */
    fun searchPlaywright(): Glue.PlaywrightSearch {
        val folders = ReadAction.compute<List<String>, RuntimeException> {
            buildList {
                project.basePath?.let { add(Glue.projectFolder(it)) }
                project.guessProjectDir()?.takeIf { it.isInLocalFileSystem }?.let { add(it.path) }
                project.getBaseDirectories().filter { it.isInLocalFileSystem }.mapTo(this) { it.path }
            }
        }
        val home = System.getProperty("user.home")?.let { runCatching { Path.of(it) }.getOrNull() }
        return Glue.findPlaywright(folders.mapNotNull { runCatching { Path.of(it) }.getOrNull() }, home).also { playwright = it }
    }

    /**
     * Search for Playwright configs off the event thread; when the answer changes, show or hide the
     * tool window and the status bar item, and start the editor service on the folders found, or
     * restart it there.
     */
    fun findPlaywright() {
        ApplicationManager.getApplication().executeOnPooledThread {
            if (project.isDisposed) return@executeOnPooledThread
            val before = playwright
            val found = searchPlaywright()
            if (found == before) return@executeOnPooledThread
            // Once the tool windows are registered.
            val tools = ToolWindowManager.getInstance(project)
            tools.invokeLater {
                if (project.isDisposed) return@invokeLater
                tools.getToolWindow(PiwiFailuresToolWindowFactory.ID)?.isAvailable = found.configDirs.isNotEmpty()
                project.service<StatusBarWidgetsManager>().updateWidget(PiwiStatusBarWidgetFactory::class.java)
            }
            val manager = LspServerManager.getInstance(project)
            when {
                manager.getServersForProvider(PiwiLspServerSupportProvider::class.java).isNotEmpty() ->
                    manager.stopAndRestartIfNeeded(PiwiLspServerSupportProvider::class.java)
                found.configDirs.isNotEmpty() -> manager.startServersIfNeeded(PiwiLspServerSupportProvider::class.java)
            }
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
        const val TIMEOUT_SECONDS = 20L
        private const val SHARED_KEY_FORGOTTEN = "piwi.sharedKeyForgotten"
    }
}

/** Searches the project for Playwright configs once it is open, off the event thread. */
class PiwiStartupActivity : ProjectActivity {
    override suspend fun execute(project: Project) {
        project.service<PiwiProjectService>().findPlaywright()
    }
}

/** The answer of a service request, or null when it failed or took too long. */
fun <T> CompletableFuture<T>.orNull(): T? =
    try {
        get(PiwiProjectService.TIMEOUT_SECONDS, TimeUnit.SECONDS)
    } catch (_: Exception) {
        null
    }

/**
 * The answer of a service request, or null when it failed or took longer than `timeoutMillis`.
 * The wait ends as soon as the platform cancels the caller: a read action gives way to a write
 * action, such as typing, and a task with progress stops at its Cancel button.
 */
fun <T> CompletableFuture<T>.awaitCancellably(timeoutMillis: Long): T? {
    val deadline = System.nanoTime() + TimeUnit.MILLISECONDS.toNanos(timeoutMillis)
    while (true) {
        ProgressManager.checkCanceled()
        try {
            return get(10, TimeUnit.MILLISECONDS)
        } catch (_: TimeoutException) {
            if (System.nanoTime() >= deadline) return null
        } catch (_: Exception) {
            return null
        }
    }
}
