package dev.piwitests.jetbrains

import com.intellij.icons.AllIcons
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.OpenFileDescriptor
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.vfs.VirtualFileManager
import com.intellij.openapi.wm.ToolWindow
import com.intellij.openapi.wm.ToolWindowFactory
import com.intellij.ui.ColoredListCellRenderer
import com.intellij.ui.SimpleTextAttributes
import com.intellij.ui.components.JBList
import com.intellij.ui.components.JBScrollPane
import com.intellij.ui.content.ContentFactory
import java.awt.event.MouseAdapter
import java.awt.event.MouseEvent
import javax.swing.DefaultListModel
import javax.swing.JList

/**
 * The failures of the latest run on the checked-out branch, listed natively:
 * the LSP client of the JetBrains IDEs highlights open files only. A double
 * click opens the failing line, where the highlight carries the quick fixes.
 */
class PiwiFailuresToolWindowFactory : ToolWindowFactory, DumbAware {
    override fun shouldBeAvailable(project: Project) = project.service<PiwiProjectService>().hasPlaywrightConfig()

    override fun createToolWindowContent(project: Project, toolWindow: ToolWindow) {
        val model = DefaultListModel<WorkspaceFailure>()
        val list = JBList(model)
        list.emptyText.text = "No failure in the latest run"
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
        val render = {
            model.clear()
            service.failures.forEach { model.addElement(it) }
            toolWindow.stripeTitle = if (service.failures.isEmpty()) "Piwi" else "Piwi (${service.failures.size})"
        }
        val content = ContentFactory.getInstance().createContent(JBScrollPane(list), "Latest run", false)
        toolWindow.contentManager.addContent(content)
        service.onChange(content, render)
        render()
    }
}
