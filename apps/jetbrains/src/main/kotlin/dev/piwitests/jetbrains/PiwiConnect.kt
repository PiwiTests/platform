package dev.piwitests.jetbrains

import com.google.gson.Gson
import com.intellij.icons.AllIcons
import com.intellij.ide.BrowserUtil
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationNamesInfo
import com.intellij.openapi.components.service
import com.intellij.openapi.progress.ProcessCanceledException
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.ui.ComboBox
import com.intellij.openapi.ui.DialogWrapper
import com.intellij.openapi.ui.Messages
import com.intellij.openapi.util.SystemInfo
import com.intellij.ui.dsl.builder.panel
import java.net.URI
import java.net.http.HttpClient
import java.net.http.HttpRequest
import java.net.http.HttpResponse
import java.time.Duration
import javax.swing.JComponent

/** The instance's side of Connect: its projects, and the browser sign-in (an RFC 8628 device authorization). */
object PiwiInstance {
    private val gson = Gson()
    private val http: HttpClient = HttpClient.newBuilder()
        .connectTimeout(Duration.ofSeconds(10))
        .followRedirects(HttpClient.Redirect.NORMAL)
        .build()

    class HttpStatus(val status: Int) : Exception("the instance answered $status")

    data class ProjectItem(val id: Int = 0, val name: String = "")
    private data class Menu(val items: List<ProjectItem>? = null)

    data class SignIn(
        val deviceCode: String = "",
        val userCode: String = "",
        val verificationUrl: String = "",
        val interval: Int = 5,
        val expiresIn: Int = 600,
    )

    data class SignInAnswer(val status: String = "", val interval: Int? = null, val apiKey: String? = null)

    fun projects(url: String, key: String?): List<ProjectItem> =
        gson.fromJson(send(url, "/api/projects/menu", key, null), Menu::class.java)?.items.orEmpty()

    /** Whether the instance asks for a key: it lists its projects to anyone when authentication is off. */
    fun needsKey(url: String): Boolean =
        try {
            projects(url, null)
            false
        } catch (e: HttpStatus) {
            if (e.status == 401 || e.status == 403) true else throw e
        }

    fun startSignIn(url: String, editor: String, os: String): SignIn =
        gson.fromJson(send(url, "/api/extension/connect", null, gson.toJson(mapOf("editor" to editor, "os" to os))), SignIn::class.java)

    fun pollSignIn(url: String, deviceCode: String): SignInAnswer =
        gson.fromJson(send(url, "/api/extension/connect/token", null, gson.toJson(mapOf("deviceCode" to deviceCode))), SignInAnswer::class.java)

    private fun send(url: String, path: String, key: String?, json: String?): String {
        val request = HttpRequest.newBuilder(URI("$url$path")).timeout(Duration.ofSeconds(15))
        if (json == null) request.GET() else request.header("Content-Type", "application/json").POST(HttpRequest.BodyPublishers.ofString(json))
        if (!key.isNullOrEmpty()) request.header("X-API-Key", key)
        val response = http.send(request.build(), HttpResponse.BodyHandlers.ofString())
        if (response.statusCode() !in 200..299) throw HttpStatus(response.statusCode())
        return response.body()
    }
}

/**
 * Piwi: Connect — the instance, a key for it (signed in with the browser, or pasted), and the
 * project. Runs on the event thread with modal progress for each request, so it works from the
 * settings page too. Returns whether it saved a connection.
 */
object PiwiConnectFlow {
    private const val TITLE = "Piwi: Connect"

    fun run(project: Project, presetUrl: String? = null): Boolean {
        val service = project.service<PiwiProjectService>()
        val url = Glue.normalizeServerUrl(presetUrl) ?: askUrl(project, service.settings().serverUrl) ?: return false
        val needsKey = request(project, "Reaching $url…") { PiwiInstance.needsKey(url) } ?: return false
        val key = if (needsKey) askKey(project, url) ?: return false else null
        val projects = request(project, "Listing the projects of $url…") { PiwiInstance.projects(url, key.orEmpty()) } ?: return false
        if (projects.isEmpty()) {
            service.saveCredentials(url, "", key)
            Messages.showInfoMessage(
                project,
                "$url has no project yet. Send a run with the Piwi reporter, then pick the project in Settings → Tools → Piwi.",
                TITLE,
            )
            return true
        }
        val names = projects.map { it.name }
        val dialog = ChooseProjectDialog(project, names, service.settings().project.takeIf { it in names } ?: names.first())
        if (!dialog.showAndGet()) return false
        val picked = dialog.picked() ?: return false
        service.saveCredentials(url, picked, key)
        // The environment, a `.env` and the desktop app come before these settings.
        val first = service.status?.contexts.orEmpty().firstOrNull {
            it.source != null && it.source != "editor" && it.serverUrl != url
        }
        if (first != null) {
            PiwiCommands.notify(
                project,
                "Saved, but ${Glue.sourceLabel(first.source)} names ${first.serverUrl}, which comes before these settings.",
                NotificationType.WARNING,
            )
        } else {
            PiwiCommands.notify(project, "Connected to $picked on $url.")
        }
        return true
    }

    private fun askUrl(project: Project, saved: String): String? {
        val input = Messages.showInputDialog(
            project,
            "The Piwi instance's address",
            TITLE,
            null,
            saved.ifBlank { "http://localhost:3000" },
            null,
        ) ?: return null
        return Glue.normalizeServerUrl(input) ?: run {
            Messages.showErrorDialog(project, "An http(s) URL, such as https://piwi.example.com", TITLE)
            null
        }
    }

    /** A key for the instance, or null when the user cancelled or the sign-in failed. */
    private fun askKey(project: Project, url: String): String? {
        val choice = Messages.showDialog(
            project,
            "$url asks for an API key. Sign in with the browser to create one for this IDE, " +
                "or paste one from the dashboard's Settings → API keys.",
            TITLE,
            arrayOf("Sign In with the Browser", "Paste an API Key", Messages.getCancelButton()),
            0,
            AllIcons.General.User,
        )
        return when (choice) {
            0 -> signIn(project, url)
            1 -> pasteKey(project)
            else -> null
        }
    }

    private fun pasteKey(project: Project): String? =
        Messages.showPasswordDialog(project, "An API key (pd_…), from the dashboard's Settings → API keys", TITLE, null)
            ?.trim()?.ifBlank { null }

    private fun signIn(project: Project, url: String): String? {
        val started = try {
            ProgressManager.getInstance().run(
                task(project, "Starting the sign-in…") { PiwiInstance.startSignIn(url, editorName(), osName()) },
            )
        } catch (e: PiwiInstance.HttpStatus) {
            if (e.status != 404) return failed(project, url, e)
            Messages.showInfoMessage(project, "This instance predates the browser sign-in: paste an API key instead.", TITLE)
            return pasteKey(project)
        } catch (_: ProcessCanceledException) {
            return null
        } catch (e: Exception) {
            return failed(project, url, e)
        }
        if (Glue.normalizeServerUrl(started.verificationUrl) == null) {
            Messages.showErrorDialog(project, "$url answered an unexpected sign-in page: ${started.verificationUrl}", TITLE)
            return null
        }
        BrowserUtil.browse(started.verificationUrl)
        val answer = request(project, "Sign in with the browser") { indicator ->
            indicator.text = "Allow the request in your browser. It shows the code ${started.userCode}."
            indicator.text2 = "No browser opened? Go to ${started.verificationUrl}"
            var interval = started.interval.coerceIn(1, 60)
            val deadline = System.currentTimeMillis() + started.expiresIn * 1000L
            var decided: PiwiInstance.SignInAnswer? = null
            while (decided == null && System.currentTimeMillis() < deadline) {
                val wakeAt = System.currentTimeMillis() + interval * 1000L
                while (System.currentTimeMillis() < wakeAt) {
                    indicator.checkCanceled()
                    Thread.sleep(100)
                }
                val polled = PiwiInstance.pollSignIn(url, started.deviceCode)
                when (polled.status) {
                    "pending" -> Unit
                    "slow_down" -> interval = (polled.interval ?: (interval + 5)).coerceIn(1, 60)
                    else -> decided = polled
                }
            }
            decided ?: PiwiInstance.SignInAnswer("expired")
        } ?: return null
        return when (answer.status) {
            "approved" -> answer.apiKey?.ifBlank { null } ?: run {
                Messages.showErrorDialog(project, "$url allowed the request but sent no key.", TITLE)
                null
            }
            "denied" -> {
                Messages.showInfoMessage(project, "The request was denied in the browser.", TITLE)
                null
            }
            else -> {
                Messages.showInfoMessage(project, "The request expired. Run Connect again.", TITLE)
                null
            }
        }
    }

    /** Run one request with modal progress; null when it was cancelled or failed, after saying why. */
    private fun <T> request(project: Project, title: String, work: (ProgressIndicator) -> T): T? =
        try {
            ProgressManager.getInstance().run(task(project, title, work))
        } catch (_: ProcessCanceledException) {
            null
        } catch (e: Exception) {
            failed(project, null, e)
        }

    private fun <T> task(project: Project, title: String, work: (ProgressIndicator) -> T) =
        object : Task.WithResult<T, Exception>(project, title, true) {
            override fun compute(indicator: ProgressIndicator): T = work(indicator)
        }

    private fun <T> failed(project: Project, url: String?, e: Exception): T? {
        val reason = when {
            e is PiwiInstance.HttpStatus && (e.status == 401 || e.status == 403) -> "the instance refused the key (${e.status})"
            else -> e.message ?: e.javaClass.simpleName
        }
        Messages.showErrorDialog(project, "Could not connect${url?.let { " to $it" } ?: ""}: $reason", TITLE)
        return null
    }

    private class ChooseProjectDialog(project: Project, names: List<String>, current: String) : DialogWrapper(project) {
        private val combo = ComboBox(names.toTypedArray()).apply { selectedItem = current }

        init {
            title = TITLE
            init()
        }

        fun picked(): String? = combo.selectedItem as? String

        override fun createCenterPanel(): JComponent = panel {
            row("Project:") { cell(combo).comment("The project this workspace reports to") }
        }
    }

    /** "WebStorm", "IntelliJ IDEA", "Rider": the name the sign-in page shows and the created key carries. */
    private fun editorName(): String = ApplicationNamesInfo.getInstance().fullProductName

    private fun osName(): String = when {
        SystemInfo.isMac -> "macOS"
        SystemInfo.isWindows -> "Windows"
        SystemInfo.isLinux -> "Linux"
        else -> SystemInfo.OS_NAME
    }
}
