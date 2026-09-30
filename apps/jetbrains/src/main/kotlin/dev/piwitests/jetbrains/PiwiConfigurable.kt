package dev.piwitests.jetbrains

import com.intellij.openapi.components.service
import com.intellij.openapi.options.BoundConfigurable
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.DialogPanel
import com.intellij.ui.dsl.builder.AlignX
import com.intellij.ui.dsl.builder.COLUMNS_LARGE
import com.intellij.ui.dsl.builder.bindText
import com.intellij.ui.dsl.builder.columns
import com.intellij.ui.dsl.builder.panel
import javax.swing.JEditorPane

/**
 * **Settings → Tools → Piwi**: the instance and project saved for this project, whether a key
 * is saved for that instance, and the connection the service actually uses.
 */
class PiwiConfigurable(private val project: Project) : BoundConfigurable("Piwi") {
    private val service get() = project.service<PiwiProjectService>()
    private lateinit var key: JEditorPane
    private lateinit var inUse: JEditorPane

    override fun createPanel(): DialogPanel {
        val settings = service.settings()
        val content = panel {
            row {
                text(
                    "The Piwi instance this project reads its test history from. PIWI_DASHBOARD_URL in the environment " +
                        "or the workspace .env comes first; then these settings; then the Piwi desktop app while it runs, " +
                        "with the project linked there to this folder.",
                    maxLineLength = 90,
                )
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
                        .comment("The project's name on the instance; empty with the desktop app uses the folder's link")
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
        inUse.text = Glue.connectionSummary(service.status)
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
