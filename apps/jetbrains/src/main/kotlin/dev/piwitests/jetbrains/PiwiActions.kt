package dev.piwitests.jetbrains

import com.google.gson.Gson
import com.intellij.ide.BrowserUtil
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.actionSystem.ActionUpdateThread
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.actionSystem.CommonDataKeys
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.vfs.VirtualFile
import java.awt.datatransfer.StringSelection
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration

private fun fileUri(file: VirtualFile): String = file.toNioPath().toUri().toString()

/** Piwi: Connect — the instance, the key (kept in the IDE's password safe) and the project. */
class ConnectAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val settings = project.getService(PiwiSettings::class.java).state
        val url = Messages.showInputDialog(
            project, "The Piwi instance", "Piwi: Connect (1/3)", null,
            settings.serverUrl.ifBlank { "http://localhost:3000" }, null,
        )?.trim()?.trimEnd('/') ?: return
        if (!url.matches(Regex("^https?://\\S+$"))) {
            Messages.showErrorDialog(project, "An http(s) URL", "Piwi: Connect")
            return
        }
        val key = Messages.showPasswordDialog(
            project,
            "An API key (pd_…), from Settings → API keys. Leave empty when the instance has no login.",
            "Piwi: Connect (2/3)", null,
        ) ?: return
        ApplicationManager.getApplication().executeOnPooledThread {
            val projects = try {
                listProjects(url, key.trim())
            } catch (ex: Exception) {
                PiwiCommands.notify(project, "Could not list the projects of $url: ${ex.message}", NotificationType.ERROR)
                return@executeOnPooledThread
            }
            ApplicationManager.getApplication().invokeLater {
                JBPopupFactory.getInstance()
                    .createPopupChooserBuilder(projects.map { it.name })
                    .setTitle("Piwi: Connect (3/3) — the project this workspace reports to")
                    .setItemChosenCallback { name ->
                        project.service<PiwiProjectService>().saveCredentials(url, name, key.trim())
                    }
                    .createPopup()
                    .showCenteredInCurrentWindow(project)
            }
        }
    }

    private data class ProjectItem(val id: Int = 0, val name: String = "")
    private data class Menu(val items: List<ProjectItem>? = null)

    private fun listProjects(url: String, key: String): List<ProjectItem> {
        val request = HttpRequest.newBuilder(URI("$url/api/projects/menu")).timeout(Duration.ofSeconds(15)).GET()
        if (key.isNotEmpty()) request.header("X-API-Key", key)
        val response = HttpClient.newHttpClient().send(request.build(), HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() !in 200..299) throw IllegalStateException("the instance answered ${response.statusCode()}")
        return Gson().fromJson(response.body(), Menu::class.java).items.orEmpty()
    }
}

class RefreshAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        ApplicationManager.getApplication().executeOnPooledThread {
            project.service<PiwiProjectService>().server()?.refresh()?.orNull()
            project.service<PiwiProjectService>().refreshStatus()
        }
    }
}

/** Piwi: Run the tests that reach this file. */
class RunTestsForFileAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE)
        e.presentation.isEnabledAndVisible = e.project != null && file != null && PiwiLspServerSupportProvider.isSupported(file)
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE) ?: return
        val uri = fileUri(file)
        ApplicationManager.getApplication().executeOnPooledThread {
            val tests = project.service<PiwiProjectService>().server()?.testsForFile(UriParams(uri))?.orNull()?.tests.orEmpty()
            if (tests.isEmpty()) PiwiCommands.notify(project, "No test reaches this file yet.")
            else PiwiCommands.runTests(project, RunTestsArgs(uri, tests.map { it.id }))
        }
    }
}

/** Piwi: Open in dashboard — this file's test, or the latest run. */
class OpenInDashboardAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val file = e.getData(CommonDataKeys.VIRTUAL_FILE)
        ApplicationManager.getApplication().executeOnPooledThread {
            val service = project.service<PiwiProjectService>()
            val tests = file?.let { service.server()?.testsForFile(UriParams(fileUri(it)))?.orNull()?.tests }.orEmpty()
            ApplicationManager.getApplication().invokeLater {
                when {
                    tests.size == 1 -> tests[0].url?.let { BrowserUtil.browse(it) }
                    tests.size > 1 -> JBPopupFactory.getInstance()
                        .createPopupChooserBuilder(tests)
                        .setRenderer(com.intellij.ui.SimpleListCellRenderer.create("") { "${it.title} · ${it.file}" })
                        .setTitle("Open which test in the dashboard?")
                        .setItemChosenCallback { t -> t.url?.let { BrowserUtil.browse(it) } }
                        .createPopup()
                        .showCenteredInCurrentWindow(project)
                    else -> Glue.statusView(service.status, service.runs).url?.let { BrowserUtil.browse(it) }
                }
            }
        }
    }
}

/** Piwi: Run selection… — one of the project's saved selections, in the Run tool window. */
class RunSelectionAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val uri = (e.getData(CommonDataKeys.VIRTUAL_FILE) ?: project.guessProjectDir())?.let { fileUri(it) } ?: ""
        ApplicationManager.getApplication().executeOnPooledThread {
            val server = project.service<PiwiProjectService>().server()
            val items = server?.selections(SelectionsParams(uri))?.orNull()?.items.orEmpty()
            if (items.isEmpty()) {
                PiwiCommands.notify(project, "This project has no selection yet.")
                return@executeOnPooledThread
            }
            ApplicationManager.getApplication().invokeLater {
                JBPopupFactory.getInstance()
                    .createPopupChooserBuilder(items)
                    .setRenderer(
                        com.intellij.ui.SimpleListCellRenderer.create("") {
                            "${it.name ?: it.key} · ${it.count} tests" + if (it.includesFile) " · includes this file" else ""
                        },
                    )
                    .setTitle("Run which selection?")
                    .setItemChosenCallback { picked ->
                        ApplicationManager.getApplication().executeOnPooledThread {
                            val command = server?.runSelection(RunSelectionParams(uri, picked.key))?.orNull()
                            if (command?.cwd != null && command.command != null) PiwiCommands.run(project, command.cwd, command.command)
                        }
                    }
                    .createPopup()
                    .showCenteredInCurrentWindow(project)
            }
        }
    }
}

/** Piwi: Copy the MCP server configuration — for the AI Assistant's MCP settings and other agents. */
class CopyMcpConfigurationAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        copyMcpConfiguration(project)
    }

    companion object {
        fun copyMcpConfiguration(project: Project) {
            ApplicationManager.getApplication().executeOnPooledThread {
                val servers = project.service<PiwiProjectService>().server()?.mcp()?.orNull()?.servers.orEmpty()
                if (servers.isEmpty()) {
                    PiwiCommands.notify(project, "Connect to an instance first.", NotificationType.WARNING)
                    return@executeOnPooledThread
                }
                CopyPasteManager.getInstance().setContents(StringSelection(Glue.mcpConfiguration(servers)))
                PiwiCommands.notify(
                    project,
                    "The MCP configuration is on the clipboard: paste it in Settings → Tools → AI Assistant → Model " +
                        "Context Protocol (or your agent's MCP settings). It holds your API key: keep it out of the repository.",
                )
            }
        }

        /** Once per installation: offer Piwi's MCP server to the IDE's agent. */
        fun offer(project: Project) {
            val properties = com.intellij.ide.util.PropertiesComponent.getInstance()
            if (properties.getBoolean(OFFERED)) return
            properties.setValue(OFFERED, true)
            NotificationGroupManager.getInstance().getNotificationGroup("Piwi")
                .createNotification(
                    "Add Piwi's MCP server to your AI assistant? It can read your suite's failures, flaky tests and healings.",
                    NotificationType.INFORMATION,
                )
                .addAction(NotificationAction.createSimpleExpiring("Copy the configuration") { copyMcpConfiguration(project) })
                .notify(project)
        }

        private const val OFFERED = "piwi.mcpOffered"
    }
}
