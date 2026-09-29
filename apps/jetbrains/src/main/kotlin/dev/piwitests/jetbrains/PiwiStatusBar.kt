package dev.piwitests.jetbrains

import com.intellij.ide.BrowserUtil
import com.intellij.openapi.actionSystem.ActionManager
import com.intellij.openapi.actionSystem.ActionPlaces
import com.intellij.openapi.actionSystem.ex.ActionUtil
import com.intellij.openapi.components.service
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.Disposer
import com.intellij.openapi.wm.StatusBar
import com.intellij.openapi.wm.StatusBarWidget
import com.intellij.openapi.wm.StatusBarWidgetFactory
import com.intellij.util.Consumer
import java.awt.Component
import java.awt.event.MouseEvent

/** The latest run on the checked-out branch, in the status bar. */
class PiwiStatusBarWidgetFactory : StatusBarWidgetFactory {
    override fun getId() = ID

    override fun getDisplayName() = "Piwi"

    override fun isAvailable(project: Project) = project.service<PiwiProjectService>().hasPlaywrightConfig()

    override fun createWidget(project: Project): StatusBarWidget = PiwiStatusBarWidget(project)

    override fun disposeWidget(widget: StatusBarWidget) = Disposer.dispose(widget)

    override fun canBeEnabledOn(statusBar: StatusBar) = true

    companion object {
        const val ID = "piwi.status"
    }
}

class PiwiStatusBarWidget(private val project: Project) : StatusBarWidget, StatusBarWidget.TextPresentation {
    private var statusBar: StatusBar? = null

    override fun ID() = PiwiStatusBarWidgetFactory.ID

    override fun install(statusBar: StatusBar) {
        this.statusBar = statusBar
        val service = project.service<PiwiProjectService>()
        service.onChange(this) {
            statusBar.updateWidget(ID())
            if (!service.status?.contexts.orEmpty().none { it.connected }) CopyMcpConfigurationAction.offer(project)
        }
        service.refreshStatus()
    }

    override fun getPresentation(): StatusBarWidget.WidgetPresentation = this

    private fun view() = project.service<PiwiProjectService>().let { Glue.statusView(it.status, it.runs) }

    override fun getText(): String = view().text

    override fun getAlignment(): Float = Component.LEFT_ALIGNMENT

    override fun getTooltipText(): String = view().tooltip

    override fun getClickConsumer(): Consumer<MouseEvent> = Consumer { event ->
        val view = view()
        val action = when (view.action) {
            Glue.StatusAction.OPEN -> {
                view.url?.let { BrowserUtil.browse(it) }
                null
            }
            Glue.StatusAction.CONNECT -> "Piwi.Connect"
            Glue.StatusAction.SETTINGS -> "Piwi.OpenSettings"
            Glue.StatusAction.NONE -> null
        }
        action?.let { ActionManager.getInstance().getAction(it) }?.let {
            ActionUtil.invokeAction(it, event.component, ActionPlaces.STATUS_BAR_PLACE, event, null)
        }
    }

    override fun dispose() {
        statusBar = null
    }
}
