package dev.piwitests.jetbrains

import com.intellij.icons.AllIcons
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.DefaultActionGroup
import com.intellij.openapi.actionSystem.Separator
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.SimpleToolWindowPanel
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.ColoredListCellRenderer
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBLabel
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import com.intellij.util.ui.JBUI
import com.intellij.util.ui.UIUtil
import java.awt.BorderLayout
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.DefaultListModel
import javax.swing.JList
import javax.swing.JPanel

/**
 * The failures of the latest run on the checked-out branch, listed natively:
 * the LSP client of the JetBrains IDEs highlights open files only. A double
 * click opens the failing line, where the highlight carries the quick fixes.
 * Above them, the connection in one line, and Connect, Refresh, Open in
 * dashboard and the settings in the toolbar.
 */
class PiwiFailuresToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun shouldBeAvailable(project: Project) = project.service<PiwiProjectService>().hasPlaywrightConfig()

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val model = DefaultListModel<WorkspaceFailure>()
        val list = JBList(model)
        list.cellRenderer = object : ColoredListCellRenderer<WorkspaceFailure>() {
            override fun customizeCellRenderer(
                list: JList<out WorkspaceFailure>,
                value: WorkspaceFailure,
                index: Int,
                selected: Boolean,
                hasFocus: Boolean,
            ) {
                icon = AllIcons.General.Error
                append(value.title ?: "Failed")
                append("  ${value.headline ?: ""}", SimpleTextAttributes.GRAYED_ATTRIBUTES)
                val file = value.uri?.substringAfterLast('/') ?: ""
                append("  $file:${value.line + 1}", SimpleTextAttributes.GRAYED_SMALL_ATTRIBUTES)
            }
        }
        list.addMouseListener(object : MouseAdapter() {
            override fun mouseClicked(e: MouseEvent) {
                if (e.clickCount != 2) return
                val failure = list.selectedValue ?: return
                val file = failure.uri?.let { VirtualFileManager.getInstance().findFileByUrl(it) } ?: return
                OpenFileDescriptor(project, file, failure.line, 0).navigate(true)
            }
        })
        val service = project.service<PiwiProjectService>()
        val connection = JBLabel().apply {
            border = JBUI.Borders.empty(4, 8)
            componentStyle = UIUtil.ComponentStyle.SMALL
            foreground = UIUtil.getContextHelpForeground()
        }
        val render: () -> Unit = {
            model.clear()
            service.failures.forEach { model.addElement(it) }
            toolWindow.stripeTitle = if (service.failures.isEmpty()) "Piwi" else "Piwi (${service.failures.size})"
            connection.text = Glue.connectionSummary(service.status)
            val connected = service.status?.contexts.orEmpty().any { it.connected }
            list.emptyText.clear()
            when {
                service.status == null -> list.emptyText.appendText(Glue.NOT_STARTED)
                !connected -> {
                    list.emptyText.appendText("Not connected to a Piwi instance")
                    list.emptyText.appendSecondaryText("Connect…", SimpleTextAttributes.LINK_PLAIN_ATTRIBUTES) {
                        PiwiConnectFlow.run(project)
                    }
                }
                else -> list.emptyText.appendText("No failure in the latest run")
            }
        }
        val actions = ActionManager.getInstance()
        val group = DefaultActionGroup(
            listOfNotNull(
                actions.getAction("Piwi.Connect"),
                actions.getAction("Piwi.Refresh"),
                actions.getAction("Piwi.OpenInDashboard"),
                Separator.getInstance(),
                actions.getAction("Piwi.OpenSettings"),
            ),
        )
        val panel = SimpleToolWindowPanel(true, true)
        val toolbar = actions.createActionToolbar("PiwiToolWindow", group, true)
        toolbar.targetComponent = panel
        panel.toolbar = toolbar.component
        panel.setContent(
            JPanel(BorderLayout()).apply {
                add(connection, BorderLayout.NORTH)
                add(JBScrollPane(list), BorderLayout.CENTER)
            },
        )
        val content = ContentFactory.getInstance().createContent(panel, "Latest run", false)
        toolWindow.contentManager.addContent(content)
        service.onChange(content, render)
        render()
        service.refreshStatus()
    }
}
