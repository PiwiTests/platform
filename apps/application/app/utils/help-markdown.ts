/**
 * Markdown → popover content for `HelpHint`.
 *
 * Help copy in `HELP_TOPICS` is Markdown: emphasis, `code`, lists and links
 * render as such, and a fenced ```mermaid block becomes a diagram. The text is
 * split into segments so the component can render the HTML ones with `v-html`
 * and hand each diagram to `HelpMermaid`, which loads Mermaid only when a hint
 * that has one is opened.
 *
 * Raw HTML in the source is escaped rather than passed through, like
 * `#shared/markdown-to-html`. A link to a docs path (`/features/…`) goes
 * through `docsUrl()`; every link opens in a new tab, since the popover closes
 * on navigation.
 */
import { Marked, type Token } from 'marked';
import { docsUrl } from '#shared/docs';
import { escapeHtml } from '#shared/markdown-to-html';

export type HelpSegment = { kind: 'html'; html: string } | { kind: 'mermaid'; source: string };

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

/** Split help Markdown into HTML runs and Mermaid diagrams, in reading order. */
export function renderHelpMarkdown(text: string): HelpSegment[] {
  const tokens = marked.lexer(text);
  const segments: HelpSegment[] = [];
  let run: Token[] = [];
  const flush = () => {
    if (!run.length) return;
    // `parser` resolves reference-style links from the list's `links`.
    segments.push({ kind: 'html', html: marked.parser(Object.assign(run, { links: tokens.links })) });
    run = [];
  };
  for (const token of tokens) {
    if (token.type === 'code' && token.lang?.trim() === 'mermaid') {
      flush();
      segments.push({ kind: 'mermaid', source: token.text });
    } else {
      run.push(token);
    }
  }
  flush();
  return segments;
}
