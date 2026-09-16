import { describe, it, expect } from 'vitest';
import { highlightCode, highlightToSpans, isKnownLanguage } from '../../shared/highlight';

describe('highlightCode', () => {
  it.each(['typescript', 'javascript', 'json', 'diff', 'yaml', 'bash', 'css', 'xml', 'python'])('knows %s', (lang) => {
    expect(isKnownLanguage(lang)).toBe(true);
  });

  it.each(['ts', 'js', 'sh', 'yml', 'html'])('accepts the %s alias the codebase writes in fences', (alias) => {
    expect(isKnownLanguage(alias)).toBe(true);
  });

  // ARIA snapshots are passed as ```yaml from several call sites; before this
  // module they fell through to auto-detection because no consumer registered it.
  it('highlights an ARIA snapshot as yaml rather than guessing', () => {
    const result = highlightCode('- button "Pay now"\n- link "Home"', 'yaml');
    expect(result.language).toBe('yaml');
    expect(result.html).toContain('hljs-');
  });

  it('marks additions and deletions in a diff', () => {
    const { html } = highlightCode('--- a/x.ts\n+++ b/x.ts\n-const a = 1;\n+const a = 2;', 'diff');
    expect(html).toContain('hljs-deletion');
    expect(html).toContain('hljs-addition');
  });

  it('emits token spans for typescript', () => {
    const { html } = highlightCode("const greeting: string = 'hi';", 'typescript');
    expect(html).toContain('hljs-keyword');
    expect(html).toContain('hljs-string');
  });

  describe('safety', () => {
    // The result is injected with v-html and raw(), so escaping is the module's job.
    it('escapes markup in highlighted source', () => {
      const { html } = highlightCode('const x = "<script>alert(1)</script>";', 'typescript');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    // Auto-detection may tokenize the source *as* HTML, splitting `&lt;` from
    // the tag name across spans. The property that matters is that the only
    // real tags in the output are highlight.js's own.
    it('emits no tags of its own beyond hljs spans', () => {
      const { html } = highlightCode('<img src=x onerror=alert(1)>');
      const withoutHljsSpans = html.replace(/<span class="hljs-[\w-]+">/g, '').replace(/<\/span>/g, '');
      expect(withoutHljsSpans).not.toMatch(/<[a-z]/i);
      expect(withoutHljsSpans).toContain('&lt;img');
    });

    it('escapes markup in a block too large to auto-detect', () => {
      const big = '<script>alert(1)</script>\n' + 'x'.repeat(200_000);
      const { html, language } = highlightCode(big);
      expect(language).toBe('');
      expect(html).not.toContain('<script>');
      expect(html).toContain('&lt;script&gt;');
    });

    it('escapes markup for an unknown language', () => {
      const { html } = highlightCode('<b>x</b>', 'not-a-language');
      expect(html).not.toContain('<b>');
    });
  });

  it('does not throw on source that violates its grammar', () => {
    expect(() => highlightCode('function ( { unbalanced', 'typescript')).not.toThrow();
  });

  it('returns empty output for empty input', () => {
    expect(highlightCode('', 'typescript').html).toBe('');
  });
});

describe('highlightToSpans', () => {
  // The PDF export paints these spans, so the concatenated text must be exactly
  // the source — no dropped, doubled, or reordered characters.
  it('reconstructs the source verbatim, quotes and angle brackets included', () => {
    const source = 'const x = "<a>" + \'y\';';
    const { spans, language } = highlightToSpans(source, 'typescript');
    expect(language).toBe('typescript');
    expect(spans.map((s) => s.text).join('')).toBe(source);
  });

  it('preserves newlines inside the span text so the caller can lay out lines', () => {
    const { spans } = highlightToSpans('const a = 1;\nconst b = 2;', 'typescript');
    expect(spans.map((s) => s.text).join('')).toContain('\n');
  });

  it('tags keywords, strings and numbers with their scope', () => {
    const { spans } = highlightToSpans("const greeting = 'hi';", 'typescript');
    const scopes = new Set(spans.map((s) => s.scope));
    expect(scopes).toContain('keyword');
    expect(scopes).toContain('string');
  });

  it('marks diff additions and deletions', () => {
    const { spans } = highlightToSpans('-const a = 1;\n+const a = 2;', 'diff');
    const scopes = spans.map((s) => s.scope);
    expect(scopes).toContain('addition');
    expect(scopes).toContain('deletion');
  });

  // highlight.js escapes `< > " '` in its output; the token stream must decode
  // them so what the PDF draws is the original text, not `&lt;`.
  it('decodes escaped entities so markup round-trips through the token stream', () => {
    const source = '<img src=x onerror="y">';
    const { spans } = highlightToSpans(source);
    expect(spans.map((s) => s.text).join('')).toBe(source);
  });

  it('leaves a block too large to auto-detect as one plain span', () => {
    const big = 'x'.repeat(200_000);
    const { spans, language } = highlightToSpans(big);
    expect(language).toBe('');
    expect(spans).toEqual([{ text: big, scope: '' }]);
  });
});
