/**
 * The one syntax-highlighting setup, shared by the dashboard components and
 * the offline export.
 *
 * Registering languages in each consumer meant the sets drifted — `yaml` was
 * passed by ARIA-snapshot call sites but registered nowhere, so those blocks
 * fell through to auto-detection. Add a language here and every surface gets it.
 */
import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import diff from 'highlight.js/lib/languages/diff';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import powershell from 'highlight.js/lib/languages/powershell';
import python from 'highlight.js/lib/languages/python';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

const LANGUAGES = { bash, css, diff, javascript, json, powershell, python, typescript, xml, yaml } as const;

for (const [name, language] of Object.entries(LANGUAGES)) {
  if (!hljs.getLanguage(name)) hljs.registerLanguage(name, language);
}
// Aliases the codebase actually writes in fences and `lang` props.
if (!hljs.getLanguage('sh')) hljs.registerLanguage('sh', bash);
if (!hljs.getLanguage('ts')) hljs.registerLanguage('ts', typescript);
if (!hljs.getLanguage('js')) hljs.registerLanguage('js', javascript);
if (!hljs.getLanguage('yml')) hljs.registerLanguage('yml', yaml);
if (!hljs.getLanguage('html')) hljs.registerLanguage('html', xml);
if (!hljs.getLanguage('pwsh')) hljs.registerLanguage('pwsh', powershell);

/**
 * Auto-detection walks every registered grammar, which is far too slow for a
 * multi-megabyte ARIA snapshot or trace payload.
 */
const MAX_AUTO_DETECT_CHARS = 100_000;

export interface HighlightResult {
  /** HTML with `hljs-*` spans. highlight.js escapes the source, so this is safe to inject. */
  html: string;
  /** The language actually used, or '' when the text was left plain. */
  language: string;
}

export function isKnownLanguage(lang: string | null | undefined): boolean {
  return Boolean(lang && hljs.getLanguage(lang));
}

/**
 * Highlight `code`, honoring an explicit language and falling back to
 * auto-detection. Never throws: an unhighlightable block returns escaped text.
 */
export function highlightCode(code: string, lang?: string | null): HighlightResult {
  try {
    if (lang && hljs.getLanguage(lang)) {
      return { html: hljs.highlight(code, { language: lang, ignoreIllegals: true }).value, language: lang };
    }
    if (code.length <= MAX_AUTO_DETECT_CHARS) {
      const result = hljs.highlightAuto(code);
      return { html: result.value, language: result.language ?? '' };
    }
  } catch {
    // Fall through to plain escaped text.
  }
  return { html: escapeForPre(code), language: '' };
}

function escapeForPre(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** A run of source text sharing one highlight.js scope, or none for plain text. */
export interface HighlightSpan {
  text: string;
  /** The innermost highlight.js scope, e.g. `keyword` or `string`; `''` when unstyled. */
  scope: string;
}

/**
 * Highlight `code` into a flat run of scoped spans — the token form a non-HTML
 * consumer (the PDF export) draws, where the HTML export takes
 * {@link highlightCode}'s markup. Newlines are preserved inside the span text so
 * the caller can lay out lines. Never throws.
 */
export function highlightToSpans(code: string, lang?: string | null): { spans: HighlightSpan[]; language: string } {
  const { html, language } = highlightCode(code, lang);
  return { spans: spansFromHtml(html), language };
}

// highlight.js output is only `<span class="…">`, `</span>` and escaped text, so
// a scanner over those three shapes recovers the token stream without a DOM.
const SPAN_TOKEN = /<span class="([^"]*)">|<\/span>|([^<]+)/g;
const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', '#x27': "'", '#39': "'" };

function unescapeEntities(text: string): string {
  return text.replace(/&(amp|lt|gt|quot|#x27|#39);/g, (whole, name: string) => ENTITIES[name] ?? whole);
}

/** The scope a nested span stack resolves to, mirroring the dashboard's CSS. */
function scopeOf(stack: string[]): string {
  const top = stack[stack.length - 1];
  if (!top) return '';
  const inner = (top.split(/\s+/)[0] ?? '').replace(/^hljs-/, '');
  // highlight.js nests a title inside `class` for class and constructor names;
  // the dashboard paints that as a built-in via `.hljs-class .hljs-title`.
  if (inner === 'title' && stack.some((s) => /\bhljs-class\b/.test(s))) return 'built_in';
  return inner;
}

function spansFromHtml(html: string): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  const stack: string[] = [];
  for (const match of html.matchAll(SPAN_TOKEN)) {
    if (match[1] !== undefined) stack.push(match[1]);
    else if (match[2] !== undefined) spans.push({ text: unescapeEntities(match[2]), scope: scopeOf(stack) });
    else stack.pop();
  }
  return spans;
}
