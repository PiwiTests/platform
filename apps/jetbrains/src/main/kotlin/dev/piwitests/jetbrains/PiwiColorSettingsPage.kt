package dev.piwitests.jetbrains

import com.intellij.openapi.editor.colors.TextAttributesKey
import com.intellij.openapi.fileTypes.PlainSyntaxHighlighter
import com.intellij.openapi.fileTypes.SyntaxHighlighter
import com.intellij.openapi.options.colors.AttributesDescriptor
import com.intellij.openapi.options.colors.ColorDescriptor
import com.intellij.openapi.options.colors.ColorSettingsPage
import javax.swing.Icon

/**
 * **Settings → Editor → Color Scheme → Piwi**: the background of a failing test, of the line it failed at, and of the
 * lines a recording writes.
 */
class PiwiColorSettingsPage : ColorSettingsPage {
    override fun getDisplayName(): String = "Piwi"

    override fun getIcon(): Icon? = null

    override fun getAttributeDescriptors(): Array<AttributesDescriptor> =
        arrayOf(
            AttributesDescriptor("Failing test", PiwiTestAnnotator.FAILING_TEST),
            AttributesDescriptor("Line it failed at", PiwiTestAnnotator.FAILING_LINE),
            AttributesDescriptor("Lines being recorded", PiwiRecordings.BLOCK),
        )

    override fun getColorDescriptors(): Array<ColorDescriptor> = ColorDescriptor.EMPTY_ARRAY

    override fun getHighlighter(): SyntaxHighlighter = PlainSyntaxHighlighter()

    override fun getDemoText(): String =
        "<failing>test('pays', async ({ page }) => {\n" +
            "  await page.goto('/checkout');\n" +
            "  <line>await page.getByRole('button', { name: 'Pay' }).click();</line>\n" +
            "});</failing>\n\n" +
            "test('lists the cart', async ({ page }) => {\n" +
            "  await expect(page.getByRole('row')).toHaveCount(2);\n" +
            "});\n\n" +
            "test('adds a coupon', async ({ page }) => {\n" +
            "<recording>  await page.goto('/cart');\n" +
            "  await page.getByRole('textbox', { name: 'Coupon' }).fill('WELCOME10');</recording>\n" +
            "});\n"

    override fun getAdditionalHighlightingTagToDescriptorMap(): Map<String, TextAttributesKey> =
        mapOf("failing" to PiwiTestAnnotator.FAILING_TEST, "line" to PiwiTestAnnotator.FAILING_LINE, "recording" to PiwiRecordings.BLOCK)
}
