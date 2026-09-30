package dev.piwitests.jetbrains

import com.intellij.icons.AllIcons
import com.intellij.lang.annotation.AnnotationHolder
import com.intellij.lang.annotation.ExternalAnnotator
import com.intellij.lang.annotation.HighlightSeverity
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
import com.intellij.openapi.components.service
import com.intellij.openapi.editor.Editor
import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.editor.markup.GutterIconRenderer
import com.intellij.openapi.project.DumbAware
import com.intellij.openapi.project.Project
import com.intellij.openapi.util.TextRange
import com.intellij.psi.PsiFile
import javax.swing.Icon

/**
 * Each test's latest result on the test itself (`piwi/fileSummary`): an icon in the gutter, its
 * details as the tooltip and a click opening it in the dashboard, and a background over a failing
 * test. The summary is fetched outside the read action.
 */
class PiwiTestAnnotator : ExternalAnnotator<PiwiTestAnnotator.Target, List<SummaryLine>>() {
    class Target(val project: Project, val uri: String)

    override fun collectInformation(file: PsiFile, editor: Editor, hasErrors: Boolean): Target? = collectInformation(file)

    override fun collectInformation(file: PsiFile): Target? {
        val virtualFile = file.virtualFile ?: return null
        if (!PiwiLspServerSupportProvider.isSupported(virtualFile)) return null
        if (!file.project.service<PiwiProjectService>().hasPlaywrightConfig()) return null
        return Target(file.project, virtualFile.toNioPath().toUri().toString())
    }

    override fun doAnnotate(target: Target?): List<SummaryLine>? {
        val server = target?.project?.service<PiwiProjectService>()?.server() ?: return null
        return server.fileSummary(UriParams(target.uri)).awaitCancellably(5_000)?.lines.orEmpty().filter { it.status != null }
    }

    override fun apply(file: PsiFile, lines: List<SummaryLine>?, holder: AnnotationHolder) {
        val document = file.viewProvider.document ?: return
        for (line in lines.orEmpty()) {
            if (line.line !in 0 until document.lineCount) continue
            val start = document.getLineStartOffset(line.line)
            val end = document.getLineEndOffset(line.line)
            val text = document.charsSequence
            var first = start
            while (first < end && text[first].isWhitespace()) first++
            if (first == end) continue
            holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
                .range(TextRange(first, end))
                .gutterIconRenderer(TestResultGutter(file.project, line))
                .create()
            if (line.status == "failed") {
                val last = (line.endLine ?: line.line).coerceIn(line.line, document.lineCount - 1)
                holder.newSilentAnnotation(HighlightSeverity.INFORMATION)
                    .range(TextRange(start, document.getLineEndOffset(last)))
                    .textAttributes(FAILING_TEST)
                    .create()
            }
        }
    }

    /** A test's latest result in the gutter; a click runs what its line names (it opens the test in the dashboard). */
    private class TestResultGutter(private val project: Project, private val line: SummaryLine) : GutterIconRenderer(), DumbAware {
        override fun getIcon(): Icon = when (line.status) {
            "failed" -> AllIcons.RunConfigurations.TestFailed
            "flaky" -> AllIcons.General.Warning
            "passed" -> AllIcons.RunConfigurations.TestPassed
            "skipped" -> AllIcons.RunConfigurations.TestIgnored
            else -> AllIcons.RunConfigurations.TestNotRan
        }

        override fun getTooltipText(): String = Glue.testResultTooltip(line.status, line.title)

        override fun isNavigateAction(): Boolean = line.command != null

        override fun getClickAction(): AnAction? = line.command?.let { command ->
            object : AnAction() {
                override fun actionPerformed(e: AnActionEvent) {
                    PiwiCommands.execute(project, command.command, command.arguments.orEmpty())
                }
            }
        }

        override fun equals(other: Any?): Boolean = other is TestResultGutter && other.line == line

        override fun hashCode(): Int = line.hashCode()
    }

    companion object {
        /** The background of a failing test: **Settings → Editor → Color Scheme → Piwi**, light red by default. */
        val FAILING_TEST: TextAttributesKey = TextAttributesKey.createTextAttributesKey("PIWI_FAILING_TEST")
    }
}
