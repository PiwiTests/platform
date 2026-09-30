package com.intellij.platform.lsp.api.lsWidget

import com.intellij.openapi.options.Configurable
import com.intellij.openapi.vfs.VirtualFile
import com.intellij.platform.lsp.api.LspServer
import javax.swing.Icon

/**
 * The Language Services widget's entry for an LSP server, as the platform declares it from
 * 2024.1 (build 241): compiled against, never packaged. The oldest supported platform has
 * no such widget, and the plugin never reaches this class there.
 */
@Suppress("UNUSED_PARAMETER", "unused")
open class LspServerWidgetItem(
    lspServer: LspServer,
    currentFile: VirtualFile?,
    icon: Icon?,
    settingsPageClass: Class<out Configurable>?,
)
