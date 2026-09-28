package dev.piwitests.jetbrains

import com.intellij.codeInsight.codeVision.CodeVisionAnchorKind
import com.intellij.codeInsight.codeVision.CodeVisionEntry
import com.intellij.codeInsight.codeVision.CodeVisionRelativeOrdering
import com.intellij.codeInsight.codeVision.ui.model.ClickableTextCodeVisionEntry
import com.intellij.codeInsight.hints.codeVision.DaemonBoundCodeVisionProvider
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.util.TextRange
import com.intellij.psi.PsiFile
import java.util.concurrent.TimeUnit

/**
 * The lines above a file, a test and a locator (`piwi/fileSummary`): the
 * tests behind each locator line, each test's pass rate, the tests that reach
 * an application file. A click runs what the line names.
 */
class PiwiCodeVisionProvider : DaemonBoundCodeVisionProvider {
    override val id = "piwi.summary"
    override val name = "Piwi"
    override val groupId = "piwi.summary"
    override val defaultAnchor: CodeVisionAnchorKind = CodeVisionAnchorKind.Top
    override val relativeOrderings: List<CodeVisionRelativeOrdering> = listOf(CodeVisionRelativeOrdering.CodeVisionRelativeOrderingFirst)

    @Deprecated("The platform calls computeForEditor(editor, file)")
    @Suppress("OVERRIDE_DEPRECATION")
    override fun computeForEditor(editor: Editor): List<Pair<TextRange, CodeVisionEntry>> = emptyList()

    override fun computeForEditor(editor: Editor, file: PsiFile): List<Pair<TextRange, CodeVisionEntry>> {
        val project = editor.project ?: return emptyList()
        val virtualFile = file.virtualFile ?: return emptyList()
        if (!PiwiLspServerSupportProvider.isSupported(virtualFile)) return emptyList()
        val server = project.service<PiwiProjectService>().server() ?: return emptyList()
        val summary = try {
            server.fileSummary(UriParams(virtualFile.toNioPath().toUri().toString())).get(3, TimeUnit.SECONDS)
        } catch (_: Exception) {
            null
        } ?: return emptyList()
        val document = editor.document
        return (listOfNotNull(summary.file) + summary.lines.orEmpty()).mapNotNull { line ->
            if (line.line < 0 || line.line >= document.lineCount || line.title.isNullOrBlank()) return@mapNotNull null
            val range = TextRange(document.getLineStartOffset(line.line), document.getLineEndOffset(line.line))
            val entry = ClickableTextCodeVisionEntry(line.title, id, { _, _ ->
                line.command?.let { PiwiCommands.execute(project, it.command, it.arguments.orEmpty()) }
            })
            range to entry
        }
    }
}
