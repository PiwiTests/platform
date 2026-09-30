package dev.piwitests.jetbrains

import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.application.ModalityState
import com.intellij.openapi.components.service
import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.COLUMNS_LARGE
import com.intellij.ui.dsl.builder.bindSelected
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.columns
import com.intellij.ui.dsl.builder.panel
import javax.swing.JEditorPane

/**
 * **Settings → Tools → Piwi**: the desktop app and whether this machine reads it first, the
 * instance and project saved for this project, whether a key is saved for that instance, and
 * the connection the service actually uses.
 */
class PiwiConfigurable(private val project: Project) : BoundConfigurable("Piwi") {
    private val service get() = project.service<PiwiProjectService>()
    private lateinit var key: JEditorPane
    private lateinit var inUse: JEditorPane
    private lateinit var desktopState: JEditorPane

    override fun createPanel(): DialogPanel {
        val settings = service.settings()
        val local = service.local()
        val content = panel {
            row {
                text(
                    "Where this project reads its test history from. PIWI_DASHBOARD_URL in the environment or the " +
                        "workspace .env comes first; then the instance below; then the Piwi desktop app while it runs. " +
                        "Choose the desktop app to read it first while it runs: the instance stays for when it does not.",
                    maxLineLength = 90,
                )
            }
            group("Piwi Desktop App") {
                row {
                    desktopState = text("").component
                }
                row {
                    checkBox("Read this project from the desktop app while it runs")
                        .bindSelected({ local.desktop }, { local.desktop = it })
                        .comment("Before the environment, the .env and the instance below. Kept for you only, in .idea/workspace.xml")
                }
                row("Project:") {
                    textField()
                        .bindText({ local.desktopProject }, { local.desktopProject = it.trim() })
                        .columns(COLUMNS_LARGE)
                        .comment("The project's name in the desktop app; empty uses the one linked there to this folder")
                }
            }
            group("Instance") {
                row("Server URL:") {
                    textField()
                        .bindText({ settings.serverUrl }, { settings.serverUrl = Glue.normalizeServerUrl(it) ?: it.trim() })
                        .columns(COLUMNS_LARGE)
                        .validationOnApply {
                            if (it.text.isBlank() || Glue.normalizeServerUrl(it.text) != null) null
                            else error("An http(s) URL, such as https://piwi.example.com")
                        }
                        .comment("Kept in .idea/piwi.xml, which the team can share")
                }
                row("Project:") {
                    textField()
                        .bindText({ settings.project }, { settings.project = it.trim() })
                        .columns(COLUMNS_LARGE)
                        .comment("The project's name on the instance")
                }
                row("API key:") {
                    key = text("").component
                }
                row {
                    button("Connect…") { connect() }
                        .comment("Sign in with the browser, or paste a key, then pick the project")
                    button("Disconnect") { disconnect() }
                }
            }
            group("In use") {
                row {
                    inUse = text("", maxLineLength = 90).align(AlignX.FILL).component
                }
                row {
                    button("Refresh") {
                        service.sendCredentials()
                    }
                }
            }
            onReset { show() }
        }
        service.onChange(disposable!!) { show() }
        return content
    }

    override fun apply() {
        val before = service.credentials()
        super.apply()
        if (service.credentials() != before) service.sendCredentials()
        show()
    }

    private fun show() {
        val url = service.settings().serverUrl
        key.text = when {
            url.isBlank() -> "None: no instance saved"
            service.hasApiKey(url) -> "Saved for $url in the IDE's password safe"
            else -> "None saved for $url"
        }
        inUse.text = Glue.connectionSummary(service.status, service.local().desktop)
        // The discovery file is on disk: read it off the event thread.
        val label = desktopState
        ApplicationManager.getApplication().executeOnPooledThread {
            val running = service.desktopUrl()
            ApplicationManager.getApplication().invokeLater(
                { label.text = running?.let { "Running on this machine at $it." } ?: "Not running on this machine." },
                ModalityState.any(),
            )
        }
    }

    private fun connect() {
        // The URL typed on this page, even before Apply.
        apply()
        val url = service.settings().serverUrl.ifBlank { null }
        if (PiwiConnectFlow.run(project, url)) reset()
    }

    private fun disconnect() {
        if (PiwiConnectFlow.disconnect(project)) reset()
    }
}
