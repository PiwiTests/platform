package dev.piwitests.jetbrains

import com.intellij.icons.AllIcons
import com.intellij.lang.annotation.AnnotationHolder
import com.intellij.lang.annotation.ExternalAnnotator
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.fileEditor.FileEditor
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.TextRange
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.psi.PsiFile
import com.intellij.ui.EditorNotificationPanel
import com.intellij.ui.EditorNotificationProvider
import java.util.function.Function
import javax.swing.JComponent

/**
 * The banner over a file a recording writes into: what it does, how many steps it wrote, and Stop, Pause or Resume;
 * once the developer changed the recorded lines, Resume or Keep My Edits. The service's command, when it offers one,
 * is a link too.
 */
class PiwiRecordingNotificationProvider : EditorNotificationProvider, DumbAware {
    override fun collectNotificationData(project: Project, file: VirtualFile): Function<in FileEditor, out JComponent?>? {
        val recordings = project.getServiceIfCreated(PiwiRecordings::class.java) ?: return null
        val session = recordings.sessionFor(file) ?: return null
        val view = session.view
        val command = session.command
        return Function { fileEditor ->
            EditorNotificationPanel(fileEditor, EditorNotificationPanel.Status.Info).apply {
                icon(AllIcons.Ide.Macro.Recording_1)
                text(view.text)
                for (action in view.actions) {
                    when (action) {
                        Glue.RecordingAction.STOP -> createActionLabel("Stop") { recordings.stop(session) }
                        Glue.RecordingAction.PAUSE -> createActionLabel("Pause") { recordings.pause(session) }
                        Glue.RecordingAction.RESUME -> createActionLabel("Resume") { recordings.resume(session) }
                        Glue.RecordingAction.KEEP_EDITS -> createActionLabel("Keep My Edits") { recordings.stop(session) }
                    }
                }
                val title = command?.title
                if (command != null && title != null) {
                    createActionLabel(title) { PiwiCommands.execute(project, command.command, command.arguments.orEmpty()) }
                }
            }
        }
    }
}

/**
 * The warnings of the recordings into a file, as weak warnings on their lines, with the message on hover: what a
 * reader of the recorded code should check (a brittle locator, a value read from the environment, a file to provide).
 * They stay after the recording, each until its line changes.
 */
class PiwiRecordingAnnotator : ExternalAnnotator<List<Pair<TextRange, String>>, List<Pair<TextRange, String>>>(), DumbAware {
    override fun collectInformation(file: PsiFile, editor: Editor, hasErrors: Boolean): List<Pair<TextRange, String>>? =
        collectInformation(file)

    override fun collectInformation(file: PsiFile): List<Pair<TextRange, String>>? {
        val document = file.viewProvider.document ?: return null
        return file.project.getServiceIfCreated(PiwiRecordings::class.java)?.warnings(document)?.ifEmpty { null }
    }

    override fun doAnnotate(collectedInfo: List<Pair<TextRange, String>>?): List<Pair<TextRange, String>>? = collectedInfo

    override fun apply(file: PsiFile, annotationResult: List<Pair<TextRange, String>>?, holder: AnnotationHolder) {
        for ((range, message) in annotationResult.orEmpty()) {
            if (range.endOffset > file.textLength) continue
            holder.newAnnotation(HighlightSeverity.WEAK_WARNING, "Piwi: $message").range(range).create()
        }
    }
}
