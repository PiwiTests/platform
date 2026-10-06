package dev.piwitests.jetbrains

import com.google.gson.Gson
import com.google.gson.JsonElement
import com.intellij.execution.ExecutionException
import com.intellij.execution.RunContentExecutor
import com.intellij.execution.configurations.GeneralCommandLine
import com.intellij.execution.process.KillableColoredProcessHandler
import com.intellij.execution.process.ProcessEvent
import com.intellij.execution.process.ProcessListener
import com.intellij.ide.BrowserUtil
import com.intellij.notification.NotificationAction
import com.intellij.notification.NotificationGroupManager
import com.intellij.notification.NotificationType
import com.intellij.openapi.application.ApplicationManager
import com.intellij.openapi.components.service
import com.intellij.openapi.fileEditor.FileEditorManager
import com.intellij.openapi.ide.CopyPasteManager
import com.intellij.openapi.progress.ProgressIndicator
import com.intellij.openapi.progress.ProgressManager
import com.intellij.openapi.progress.Task
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.SystemInfo
import com.intellij.openapi.vfs.LocalFileSystem
import com.intellij.openapi.wm.ToolWindowManager
import java.awt.datatransfer.StringSelection
import java.nio.file.Path

/**
 * The client commands the editor service names in summary lines and code
 * actions (`piwi.openInDashboard`, `piwi.runTests`, `piwi.openTrace`,
 * `piwi.openScreenshot`, `piwi.runCommand`, `piwi.copyText`, `piwi.desktopJob`).
 */
object PiwiCommands {
    private val gson = Gson()

    private inline fun <reified T> arg(value: Any?): T? = when (value) {
        is JsonElement -> gson.fromJson(value, T::class.java)
        null -> null
        else -> gson.fromJson(gson.toJsonTree(value), T::class.java)
    }

    fun execute(project: Project, command: String?, arguments: List<Any?>) {
        when (command) {
            "piwi.openInDashboard" -> arg<String>(arguments.firstOrNull())?.let { BrowserUtil.browse(it) }
            "piwi.runTests" -> arg<RunTestsArgs>(arguments.firstOrNull())?.let { runTests(project, it) }
            "piwi.openTrace" -> arg<TraceParams>(arguments.firstOrNull())?.let { openTrace(project, it) }
            "piwi.openScreenshot" -> arg<TraceParams>(arguments.firstOrNull())?.let { openScreenshot(project, it) }
            "piwi.runCommand" -> arg<RunCommandArgs>(arguments.firstOrNull())?.let { run(project, it.cwd, it.command, it.env) }
            "piwi.copyText" -> arg<String>(arguments.firstOrNull())?.let {
                CopyPasteManager.getInstance().setContents(StringSelection(it))
                notify(project, "Copied. Paste it to your agent.")
            }
            "piwi.desktopJob" -> arg<DesktopJobParams>(arguments.firstOrNull())?.let { desktopJob(project, it) }
        }
    }

    /**
     * Pass a failure or a flaky test from the team instance to the desktop app, which waits for the developer to start
     * it.
     */
    fun desktopJob(project: Project, params: DesktopJobParams) {
        background(project, "Piwi: passing the job to the desktop app") {
            val result = project.service<PiwiProjectService>().server()?.desktopJob(params)?.orNull()
            notify(
                project,
                result?.message ?: "The editor service is not running.",
                if (result?.ok == true) NotificationType.INFORMATION else NotificationType.WARNING,
            )
        }
    }

    /** Show a job's update, with the button that shares its verdict on the instance when it has one. */
    fun desktopJobChanged(project: Project, update: DesktopJobUpdate) {
        val notice = Glue.desktopJobNotice(update)
        val notification = NotificationGroupManager.getInstance().getNotificationGroup("Piwi")
            .createNotification(notice.text, if (notice.warning) NotificationType.WARNING else NotificationType.INFORMATION)
        val jobId = update.jobId
        if (jobId != null) {
            for (label in notice.actions) {
                notification.addAction(NotificationAction.createSimpleExpiring(label) { shareDesktopJob(project, jobId) })
            }
        }
        notification.notify(project)
    }

    private fun shareDesktopJob(project: Project, jobId: String) {
        background(project, "Piwi: sharing the verdict") {
            val result = project.service<PiwiProjectService>().server()?.shareDesktopJob(ShareDesktopJobParams(jobId))?.orNull()
            val notification = NotificationGroupManager.getInstance().getNotificationGroup("Piwi").createNotification(
                result?.message ?: "The editor service is not running.",
                if (result?.ok == true) NotificationType.INFORMATION else NotificationType.WARNING,
            )
            result?.url?.let { url ->
                notification.addAction(NotificationAction.createSimpleExpiring("Open in the dashboard") { BrowserUtil.browse(url) })
            }
            notification.notify(project)
        }
    }

    /** Run every test still failing or edited since its run, as `piwi/failures` lists them. */
    fun rerunFailing(project: Project) {
        background(project, "Piwi: resolving the failing tests") {
            val failures = project.service<PiwiProjectService>().server()?.failures()?.orNull()
            val args = Glue.rerunFailingArgs(failures)
            if (args == null) notify(project, "No failing test to re-run.") else runTests(project, args)
        }
    }

    /** Copy one block about a failure for a coding agent: the failure, its healing and its cluster's fix plan. */
    fun copyAgentContext(project: Project, params: TraceParams) {
        background(project, "Piwi: gathering the failure's context") {
            val text = project.service<PiwiProjectService>().server()?.agentContext(params)?.orNull()?.text
            if (text == null) {
                notify(project, "This failure is no longer in the latest run.", NotificationType.WARNING)
            } else {
                CopyPasteManager.getInstance().setContents(StringSelection(text))
                notify(project, "Copied. Paste it to your agent.")
            }
        }
    }

    /**
     * Say what a run started from the IDE changed, as **Settings → Tools → Piwi** allows, with the failures, the run's
     * page and **Re-run Failing** one click away.
     */
    fun runEnded(project: Project, ended: RunEnded) {
        val setting = project.service<PiwiProjectService>().settings().runNotifications
        val verdict = Glue.runVerdict(ended, setting) ?: return
        val notification = NotificationGroupManager.getInstance().getNotificationGroup("Piwi")
            .createNotification(verdict.text, if (verdict.warning) NotificationType.WARNING else NotificationType.INFORMATION)
        for (label in verdict.actions) {
            notification.addAction(
                NotificationAction.createSimpleExpiring(label) {
                    when (label) {
                        Glue.OPEN_FAILURES -> ToolWindowManager.getInstance(project)
                            .getToolWindow(PiwiFailuresToolWindowFactory.ID)?.activate(null)
                        Glue.OPEN_IN_DASHBOARD -> ended.url?.let { BrowserUtil.browse(it) }
                        Glue.RERUN_FAILING -> rerunFailing(project)
                    }
                },
            )
        }
        notification.notify(project)
    }

    fun runTests(project: Project, args: RunTestsArgs) {
        background(project, "Piwi: resolving the tests") {
            val command = project.service<PiwiProjectService>().server()?.runArgs(args)?.orNull()
            if (command?.command.isNullOrBlank() || command?.cwd == null) {
                notify(project, "No command to run these tests (not connected?).", NotificationType.WARNING)
            } else {
                run(project, command.cwd, command.command!!, command.env, command.ref)
            }
        }
    }

    fun openTrace(project: Project, params: TraceParams) {
        background(project, "Piwi: downloading the trace") {
            val trace = project.service<PiwiProjectService>().server()?.trace(params)?.orNull()
            if (trace?.command == null || trace.cwd == null) {
                notify(project, "This failure has no trace to open.", NotificationType.WARNING)
            } else {
                run(project, trace.cwd, trace.command)
            }
        }
    }

    /** Download a failure's screenshot and open it in an editor tab. */
    fun openScreenshot(project: Project, params: TraceParams) {
        background(project, "Piwi: downloading the screenshot") {
            val path = project.service<PiwiProjectService>().server()?.screenshot(params)?.orNull()?.path
            val file = path?.let { LocalFileSystem.getInstance().refreshAndFindFileByNioFile(Path.of(it)) }
            if (file == null) {
                notify(project, "This failure has no screenshot to open.", NotificationType.WARNING)
            } else {
                ApplicationManager.getApplication().invokeLater({
                    FileEditorManager.getInstance(project).openFile(file, true)
                }, project.disposed)
            }
        }
    }

    /**
     * Run a command line in the Run tool window, in `cwd`, with `env` added to its environment: the process starts off
     * the event thread. With `ref`, the ref of the run it starts, the service hears when it ends
     * (`piwi/commandEnded`). The tool window's Rerun stops it if it runs, and starts the same command, ref included.
     */
    fun run(project: Project, cwd: String, command: String, env: Map<String, String>? = null, ref: String? = null) {
        val parts = Glue.splitCommand(command).toMutableList()
        if (parts.isEmpty()) return
        if (SystemInfo.isWindows && parts[0] in setOf("npx", "npm", "node")) {
            if (parts[0] != "node") parts[0] = "${parts[0]}.cmd"
        }
        ApplicationManager.getApplication().executeOnPooledThread {
            val handler = try {
                val commandLine = GeneralCommandLine(parts).withWorkDirectory(cwd).withCharset(Charsets.UTF_8)
                if (!env.isNullOrEmpty()) commandLine.withEnvironment(env)
                KillableColoredProcessHandler(commandLine)
            } catch (e: ExecutionException) {
                notify(project, "Could not run ${parts[0]}: ${e.message}", NotificationType.ERROR)
                return@executeOnPooledThread
            }
            if (ref != null) {
                handler.addProcessListener(object : ProcessListener {
                    override fun processTerminated(event: ProcessEvent) {
                        val ended = CommandEndedParams(ref, event.exitCode)
                        ApplicationManager.getApplication().executeOnPooledThread {
                            if (!project.isDisposed) project.service<PiwiProjectService>().server()?.commandEnded(ended)
                        }
                    }
                })
            }
            ApplicationManager.getApplication().invokeLater {
                if (project.isDisposed) {
                    handler.destroyProcess()
                } else {
                    RunContentExecutor(project, handler)
                        .withTitle("Piwi")
                        .withActivateToolWindow(true)
                        .withRerun {
                            handler.destroyProcess()
                            run(project, cwd, command, env, ref)
                        }
                        .run()
                }
            }
        }
    }

    fun notify(project: Project, message: String, type: NotificationType = NotificationType.INFORMATION) {
        NotificationGroupManager.getInstance().getNotificationGroup("Piwi").createNotification(message, type).notify(project)
    }

    private fun background(project: Project, title: String, body: () -> Unit) {
        ProgressManager.getInstance().run(object : Task.Backgroundable(project, title, true) {
            override fun run(indicator: ProgressIndicator) = body()
        })
    }
}
