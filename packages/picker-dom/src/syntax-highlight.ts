/** One lexical piece of a Playwright locator expression. */
export type LocatorTokenKind = 'string' | 'method' | 'option' | 'literal' | 'punctuation' | 'plain';

/** A tokenized slice of a locator expression, in source order. */
export interface LocatorToken {
  kind: LocatorTokenKind;
  text: string;
}

/** CSS class emitted for each token kind, styled by `LOCATOR_SYNTAX_CSS`. */
export const LOCATOR_TOKEN_CLASS: Record<LocatorTokenKind, string> = {
  string: 'piwi-tok-str',
  method: 'piwi-tok-fn',
  option: 'piwi-tok-key',
  literal: 'piwi-tok-lit',
  punctuation: 'piwi-tok-punc',
  plain: 'piwi-tok-plain',
};

const TOKEN_RE =
  /('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")|([A-Za-z_$][\w$]*)(?=\s*\()|([A-Za-z_$][\w$]*)(?=\s*:)|(true|false|null|\d+)|([{}(),.])/g;

/**
 * Split a locator expression into method names, string arguments, option keys,
 * literals, punctuation and the plain text between them. Pure — the rendering
 * helpers below and any host that wants its own markup (a Vue template, say)
 * share this one lexer.
 */
export function tokenizeLocator(expr: string): LocatorToken[] {
  const tokens: LocatorToken[] = [];
  const re = new RegExp(TOKEN_RE.source, 'g');
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(expr)) !== null) {
    if (m.index > last) tokens.push({ kind: 'plain', text: expr.slice(last, m.index) });
    const kind: LocatorTokenKind = m[1]
      ? 'string'
      : m[2]
        ? 'method'
        : m[3]
          ? 'option'
          : m[4]
            ? 'literal'
            : 'punctuation';
    tokens.push({ kind, text: m[0] });
    last = re.lastIndex;
  }
  if (last < expr.length) tokens.push({ kind: 'plain', text: expr.slice(last) });
  return tokens;
}

const escHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * Syntax-highlight a locator expression to class-annotated HTML. The colors
 * come from `LOCATOR_SYNTAX_CSS`, which the host must have in scope (its shadow
 * root's `<style>`, or a stylesheet) — that indirection is what lets the same
 * markup stay legible on a dark panel and on a light one.
 *
 * A normally-importable twin of the nested copies inside `overlay-element.ts`
 * and `overlay-confirm.ts`: those two must stay self-contained (each is
 * independently re-serialized via `Function.prototype.toString()`) and inline
 * their colors, since a serialized overlay injects into a page whose
 * stylesheets are none of its business.
 */
export function highlightLocator(expr: string): string {
  let html = '';
  for (const token of tokenizeLocator(expr)) {
    if (token.kind === 'plain') {
      html += escHtml(token.text);
      continue;
    }
    html += `<span class="${LOCATOR_TOKEN_CLASS[token.kind]}">${escHtml(token.text)}</span>`;
  }
  return html;
}

/**
 * Token colors for `highlightLocator`'s markup, plus a `.piwi-loc` wrapper that
 * gives locator code its monospace face and wrapping. Dark-first (matching the
 * overlay panels' own default), with a light-scheme override — each palette is
 * contrast-checked against the background it renders on, `#111827` and
 * `#ffffff`.
 *
 * A host whose panel is dark in *both* schemes (a locator chip floating over an
 * arbitrary page, say) adds `.piwi-loc-dark` to the wrapper to opt out of the
 * light override.
 */
export const LOCATOR_SYNTAX_CSS = `
  .piwi-loc {
    font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
    font-variant-ligatures: none;
    word-break: break-word;
    overflow-wrap: anywhere;
  }
  .piwi-tok-fn { color: #d8b4fe; }
  .piwi-tok-str { color: #86efac; }
  .piwi-tok-key { color: #93c5fd; }
  .piwi-tok-lit { color: #fcd34d; }
  .piwi-tok-punc { color: #9ca3af; }
  @media (prefers-color-scheme: light) {
    .piwi-loc:not(.piwi-loc-dark) .piwi-tok-fn { color: #6d28d9; }
    .piwi-loc:not(.piwi-loc-dark) .piwi-tok-str { color: #15803d; }
    .piwi-loc:not(.piwi-loc-dark) .piwi-tok-key { color: #1d4ed8; }
    .piwi-loc:not(.piwi-loc-dark) .piwi-tok-lit { color: #b45309; }
    .piwi-loc:not(.piwi-loc-dark) .piwi-tok-punc { color: #6b7280; }
  }
`;
