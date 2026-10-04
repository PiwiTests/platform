/** Whether a path is a bug report saved by Piwi Picker rather than a Playwright archive. */
export function isBugReportFile(path: string): boolean {
  return path.toLowerCase().endsWith('.piwibug');
}

/**
 * Files the OS handed to the desktop app (dropped on the window, opened with
 * the app, passed to a second launch) waiting to be imported. Shared between
 * the plugin that collects them and the import dialog that consumes them;
 * only Playwright archives (`.zip`) and Piwi Picker's bug reports
 * (`.piwibug`) ever enter the queue.
 */
export function useDesktopImportQueue() {
  const files = useState<string[]>('desktop-import-files', () => []);
  const open = useState<boolean>('desktop-import-open', () => false);

  function addFiles(paths: string[]) {
    const accepted = paths.filter((p) => p.toLowerCase().endsWith('.zip') || isBugReportFile(p));
    if (accepted.length === 0) return;
    files.value = [...new Set([...files.value, ...accepted])];
    open.value = true;
  }

  function removeFile(path: string) {
    files.value = files.value.filter((p) => p !== path);
  }

  function clear() {
    files.value = [];
  }

  return { files, open, addFiles, removeFile, clear };
}
