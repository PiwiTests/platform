import { isSafeLinkTarget } from '#shared/utils/safe-url';

function escapeMarkdownText(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Render a Markdown line's inline `code`, **bold** and [links] to safe HTML for
 * `MarkdownPreview`. Escapes first; a link whose target is not http(s), mailto
 * or same-site stays text.
 */
export function inlineMarkdownHtml(raw: string): string {
  let h = escapeMarkdownText(raw);
  h = h.replace(/`([^`]+)`/g, '<code class="rounded bg-gray-200 dark:bg-gray-700 px-1 py-px">$1</code>');
  h = h.replace(/\*\*([^*]+)\*\*/g, '<strong class="text-gray-900 dark:text-gray-100">$1</strong>');
  h = h.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text: string, href: string) =>
    isSafeLinkTarget(href) && !/[<>"\s]/.test(href)
      ? `<a href="${href}" target="_blank" rel="noopener" class="text-primary hover:underline">${text}</a>`
      : match,
  );
  return h;
}
