/**
 * Extended clipboard helper that writes both text/plain and text/html simultaneously.
 * Rich-text editors (Slack, Jira, Notion, Google Docs) use the HTML format; plain
 * text contexts get the clean fallback. Falls back to plain text when the
 * ClipboardItem API is unavailable (older browsers, insecure contexts).
 */
export function useCopyRich(options: { duration?: number } = {}) {
  const copied = ref(false);
  const toast = useToast();
  let timer: ReturnType<typeof setTimeout> | null = null;

  async function copyRich(plain: string, html: string, opts: { toast?: boolean | string } = {}) {
    try {
      if (typeof ClipboardItem !== 'undefined') {
        await navigator.clipboard.write([
          new ClipboardItem({
            'text/plain': new Blob([plain], { type: 'text/plain' }),
            'text/html': new Blob([html], { type: 'text/html' }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      copied.value = true;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        copied.value = false;
        timer = null;
      }, options.duration ?? 2000);
      if (opts.toast) {
        toast.add({
          title: typeof opts.toast === 'string' ? opts.toast : 'Copied to clipboard',
          icon: 'i-lucide-check',
          color: 'success',
          duration: 2000,
        });
      }
    } catch {
      // Clipboard unavailable
    }
  }

  return { copyRich, copied };
}
