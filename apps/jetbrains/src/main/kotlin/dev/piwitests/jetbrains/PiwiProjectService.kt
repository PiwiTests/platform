package dev.piwitests.jetbrains

import com.intellij.codeInsight.daemon.DaemonCodeAnalyzer
import com.intellij.credentialStore.generateServiceName
import com.intellij.ide.passwordSafe.PasswordSafe
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.Disposable
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.PersistentStateComponent
import com.intellij.openapi.components.Service
import com.intellij.openapi.components.State
import com.intellij.openapi.components.Storage
import com.intellij.openapi.components.StoragePathMacros
import com.intellij.openapi.components.service
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.project.BaseProjectDirectories.Companion.getBaseDirectories
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.startup.ProjectActivity
import com.intellij.openapi.util.Computable
import com.intellij.openapi.wm.ToolWindowManager
import com.intellij.openapi.wm.impl.status.widget.StatusBarWidgetsManager
import com.intellij.platform.lsp.api.LspServerManager
import java.nio.file.Files
import java.nio.file.Path
import java.util.concurrent.CompletableFuture
import java.util.concurrent.CopyOnWriteArrayList
import java.util.concurrent.TimeUnit
import java.util.concurrent.TimeoutException

/**
 * The instance and project this project reports to, when the environment and `.env` name
 * none: **Settings → Tools → Piwi**, kept in `.idea/piwi.xml`. The key is not here but in
 * the password safe, per instance.
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
 * What this machine keeps for the project, in `.idea/workspace.xml`, never in a file the
 * team shares: the desktop app chosen with Connect, its project, and whether it was offered;
 * and a recording's choices: the Playwright project, the start page, and the last page
 * expression typed that was not among those offered.
 */
@Service(Service.Level.PROJECT)
@State(name = "PiwiLocalSettings", storages = [Storage(StoragePathMacros.WORKSPACE_FILE)])
class PiwiLocalSettings : PersistentStateComponent<PiwiLocalSettings.State> {
    data class State(
        var desktop: Boolean = false,
        var desktopProject: String = "",
        var desktopOffered: Boolean = false,
        var recordProject: String = "",
        var recordStartUrl: String = "",
        var recordPage: String = "",
    )

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

    /** Whether a click on the status bar item is reading the latest run again. */
    @Volatile var refreshing = false
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
        val folders = ApplicationManager.getApplication().runReadAction(Computable {
            buildList {
                project.basePath?.let { add(Glue.projectFolder(it)) }
                project.guessProjectDir()?.takeIf { it.isInLocalFileSystem }?.let { add(it.path) }
                project.getBaseDirectories().filter { it.isInLocalFileSystem }.mapTo(this) { it.path }
            }
        })
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

    fun local(): PiwiLocalSettings.State = project.getService(PiwiLocalSettings::class.java).state

    /**
     * The connection saved in the IDE: this project's instance and project, that instance's key,
     * and whether this machine reads the desktop app first.
     */
    fun credentials(): EditorCredentials {
        forgetSharedKey()
        val settings = settings()
        val local = local()
        val url = settings.serverUrl.ifBlank { null }
        return EditorCredentials(
            serverUrl = url,
            project = settings.project.ifBlank { null },
            apiKey = url?.let { PasswordSafe.instance.getPassword(credentialAttributes(it)) },
            desktop = local.desktop,
            desktopProject = local.desktopProject.ifBlank { null },
        )
    }

    /** Whether the password safe holds a key for the instance. */
    fun hasApiKey(serverUrl: String): Boolean =
        serverUrl.isNotBlank() && !PasswordSafe.instance.getPassword(credentialAttributes(serverUrl)).isNullOrEmpty()

    /**
     * Save the instance and project, and hand them to the service; a null key forgets the
     * instance's key. The instance is read rather than the desktop app from then on.
     */
    fun saveCredentials(serverUrl: String, projectName: String, apiKey: String?) {
        val url = Glue.normalizeServerUrl(serverUrl) ?: serverUrl.trim()
        val settings = settings()
        settings.serverUrl = url
        settings.project = projectName.trim()
        if (url.isNotBlank()) PasswordSafe.instance.setPassword(credentialAttributes(url), apiKey?.trim()?.ifBlank { null })
        local().desktop = false
        sendCredentials()
    }

    /**
     * Read the desktop app first while it runs, on `projectName`, or with none on the project
     * linked there to the folder. The saved instance stays, for when the app does not run.
     */
    fun useDesktop(projectName: String?) {
        val local = local()
        local.desktop = true
        local.desktopProject = projectName?.trim().orEmpty()
        local.desktopOffered = true
        sendCredentials()
    }

    /** Read the instance the environment, the `.env` or the settings name again, rather than the desktop app. */
    fun useInstance() {
        local().desktop = false
        sendCredentials()
    }

    /** Forget this project's instance and project, that instance's key, and the choice of the desktop app. */
    fun disconnect() {
        val settings = settings()
        if (settings.serverUrl.isNotBlank()) PasswordSafe.instance.setPassword(credentialAttributes(settings.serverUrl), null)
        settings.serverUrl = ""
        settings.project = ""
        local().desktop = false
        local().desktopProject = ""
        sendCredentials()
    }

    /**
     * The desktop app running on this machine, as the service's `piwi/desktop` answers it; read
     * here from its discovery file while the service has not started (it starts with the first
     * file opened). Blocks on the network: never on the event thread.
     */
    fun desktop(): DesktopResult {
        server()?.desktop()?.awaitCancellably(TIMEOUT_SECONDS * 1000)?.let { return it }
        val discovery = readDesktopDiscovery() ?: return DesktopResult()
        val projects = runCatching { PiwiInstance.projects(discovery.url, discovery.token) }.getOrDefault(emptyList())
            .map { ProjectRef(it.id, it.name) }
        val linked = Glue.linkedDesktopProject(discovery.links, playwrightConfigDirs().firstOrNull())
        return DesktopResult(discovery.url, projects, projects.firstOrNull { it.id == linked })
    }

    /** The desktop app's address while it runs, from the service's status or its discovery file; reads the disk. */
    fun desktopUrl(): String? = status?.desktopUrl ?: readDesktopDiscovery()?.url

    private fun readDesktopDiscovery(): Glue.DesktopDiscovery? {
        val file = Glue.desktopConfigPath(System.getenv(), System.getProperty("user.home")) ?: return null
        return Glue.parseDesktopDiscovery(runCatching { Files.readString(file) }.getOrNull())
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

    /**
     * Read the latest run and its failures again, not the indexes **Refresh** fetches (`piwi/refreshRun`), then the
     * status, on a pooled thread: the status bar item's click. `refreshing` is set meanwhile.
     */
    fun refreshRun() {
        if (refreshing) return
        refreshing = true
        ApplicationManager.getApplication().executeOnPooledThread {
            try {
                server()?.refreshRun()?.orNull()
            } finally {
                refreshing = false
            }
            refreshStatus()
        }
    }

    /** Read the status, the latest run and its failures again, then tell the listeners. */
    fun refreshStatus() {
        ApplicationManager.getApplication().executeOnPooledThread {
            val server = server()
            val before = runs
            status = server?.status()?.orNull()
            runs = server?.runStatus()?.orNull()
            failures = server?.failures()?.orNull()?.items.orEmpty()
            ApplicationManager.getApplication().invokeLater({
                listeners.forEach { it() }
                // Another run: the gutter, the backgrounds and Code Vision of the open files show it. A run in progress
                // moves the status bar alone.
                if (Glue.runsInFiles(runs) != Glue.runsInFiles(before)) DaemonCodeAnalyzer.getInstance(project).restart()
            }, project.disposed)
            offerDesktop(status)
        }
    }

    /**
     * Once per project: when the desktop app runs while another instance is in use, offer to read
     * the project from the app. The other instance stays saved, one Connect away.
     */
    @Synchronized
    private fun offerDesktop(status: StatusResult?) {
        val local = local()
        if (status?.desktopUrl == null || local.desktopOffered) return
        val contexts = status.contexts.orEmpty()
        val current = contexts.firstOrNull { it.connected } ?: contexts.firstOrNull() ?: return
        if (current.source == "desktop" || current.serverUrl == null) return
        local.desktopOffered = true
        NotificationGroupManager.getInstance().getNotificationGroup("Piwi")
            .createNotification(
                "The Piwi desktop app runs on this machine. Read this project from it rather than ${current.serverUrl}? " +
                    "Connect switches back.",
                NotificationType.INFORMATION,
            )
            .addAction(NotificationAction.createSimpleExpiring("Use the Desktop App") { PiwiConnectFlow.useDesktop(project) })
            .notify(project)
    }

    override fun dispose() {
        listeners.clear()
    }

    private fun credentialAttributes(serverUrl: String) =
        PiwiCredentials.attributes(generateServiceName("Piwi", Glue.apiKeyEntry(serverUrl)))

    /**
     * Deletes the key shared by every instance, once: a project naming another
     * instance would send it there. Connect again to save a key per instance.
     */
    private fun forgetSharedKey() {
        val properties = com.intellij.ide.util.PropertiesComponent.getInstance()
        if (properties.getBoolean(SHARED_KEY_FORGOTTEN)) return
        properties.setValue(SHARED_KEY_FORGOTTEN, true)
        PasswordSafe.instance.setPassword(PiwiCredentials.attributes(generateServiceName("Piwi", "apiKey")), null)
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
