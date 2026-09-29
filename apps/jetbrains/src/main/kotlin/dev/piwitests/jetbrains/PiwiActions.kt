package dev.piwitests.jetbrains

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
import com.intellij.openapi.options.ShowSettingsUtil
import com.intellij.openapi.project.Project
import com.intellij.openapi.project.guessProjectDir
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.ui.popup.JBPopupFactory
import com.intellij.openapi.vfs.VirtualFile
import java.awt.datatransfer.StringSelection

private fun fileUri(file: VirtualFile): String = file.toNioPath().toUri().toString()

/** Piwi: Connect — the instance, a key for it (browser sign-in or pasted) and the project. */
class ConnectAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        PiwiConnectFlow.run(project)
    }
}

/** Piwi: Disconnect — forget this project's instance, project and the key saved for that instance. */
class DisconnectAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun update(e: AnActionEvent) {
        val project = e.project
        e.presentation.isEnabled = project != null && project.service<PiwiProjectService>().settings().serverUrl.isNotBlank()
    }

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        val service = project.service<PiwiProjectService>()
        val url = service.settings().serverUrl.ifBlank { return }
        val answer = Messages.showYesNoDialog(
            project,
            "Forget $url, the project, and the API key saved for it?",
            "Piwi: Disconnect",
            null,
        )
        if (answer == Messages.YES) service.disconnect()
    }
}

/** Piwi: Settings… — **Settings → Tools → Piwi**. */
class OpenSettingsAction : AnAction() {
    override fun getActionUpdateThread() = ActionUpdateThread.BGT

    override fun actionPerformed(e: AnActionEvent) {
        val project = e.project ?: return
        ShowSettingsUtil.getInstance().showSettingsDialog(project, PiwiConfigurable::class.java)
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
