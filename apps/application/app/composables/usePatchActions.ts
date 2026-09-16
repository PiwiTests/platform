/**
 * The clipboard and download actions for a suggested unified-diff patch, in one
 * place so the patch block and the next-step line share the exact same behaviour
 * instead of re-implementing `git apply` framing or the download dance.
 */
export function usePatchActions() {
  const { copy, copied } = useCopy();

  function copyPatch(patch: string) {
    copy(patch, { toast: 'Patch copied' });
  }

  function copyGitApply(patch: string) {
    copy(`git apply <<'EOF'\n${patch}\nEOF`, { toast: 'git apply command copied' });
  }

  function downloadPatch(patch: string, downloadName = 'piwi-fix') {
    const body = patch.endsWith('\n') ? patch : patch + '\n';
    const blob = new Blob([body], { type: 'text/x-patch' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${downloadName}.patch`;
    document.body.appendChild(a);
    a.click();
    // Defer cleanup so the download isn't cut short mid-flight in some browsers.
    setTimeout(() => {
      a.remove();
      URL.revokeObjectURL(url);
    }, 1000);
  }

  return { copy, copied, copyPatch, copyGitApply, downloadPatch };
}
