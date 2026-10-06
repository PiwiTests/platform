/**
 * Markdown → popover HTML for `HelpHint`.
 *
 * Help copy in `HELP_TOPICS` is Markdown: emphasis, `code`, lists and links
 * render as such.
 *
 * Raw HTML in the source is escaped rather than passed through, like
 * `#shared/markdown-to-html`. A link to a docs path (`/features/…`) goes
 * through `docsUrl()`; every link opens in a new tab, since the popover closes
 * on navigation.
 */
import { Marked } from 'marked';
import { docsUrl } from '#shared/docs';
import { escapeHtml } from '#shared/markdown-to-html';

const DOCS_PATH = /^\/(?:guide|features|operate|reference|recipes)\//;
const EXTERNAL_URL = /^(?:https?:|mailto:)/i;

const marked = new Marked({
  renderer: {
    html: (token: { text: string } | string) => escapeHtml(typeof token === 'string' ? token : token.text),
    link(token) {
      const label = this.parser.parseInline(token.tokens);
      const docs = DOCS_PATH.test(token.href);
      if (!docs && !EXTERNAL_URL.test(token.href)) return label;
      const href = docs ? docsUrl(token.href) : token.href;
      return `<a href="${escapeHtml(href)}" target="_blank" rel="noopener noreferrer">${label}</a>`;
    },
    // Help copy never needs a remote image; keep the alt text.
    image: (token: { text?: string | null; href: string }) => escapeHtml(token.text || token.href),
  },
});

export function renderHelpMarkdown(text: string): string {
  return marked.parse(text, { async: false });
}
