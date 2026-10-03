import { describe, it, expect } from 'vitest';
import { docsUrl } from '#shared/docs';
import { HELP_TOPICS } from '~/utils/help-content';
import { renderHelpMarkdown } from '~/utils/help-markdown';

const html = (text: string) =>
  renderHelpMarkdown(text)
    .map((segment) => (segment.kind === 'html' ? segment.html : `[mermaid:${segment.source}]`))
    .join('');

describe('renderHelpMarkdown', () => {
  it('renders a plain hint as one paragraph', () => {
    expect(renderHelpMarkdown('Just a sentence.')).toEqual([{ kind: 'html', html: '<p>Just a sentence.</p>\n' }]);
  });

  it('renders emphasis, code and lists', () => {
    const out = html(['Lead.', '', '- **Lanes** — one per `worker`.', '- Two.'].join('\n'));
    expect(out).toContain('<strong>Lanes</strong>');
    expect(out).toContain('<code>worker</code>');
    expect(out).toContain('<li>Two.</li>');
  });

  it('splits a mermaid block out as its own segment, in order', () => {
    const segments = renderHelpMarkdown(
      ['Before.', '', '```mermaid', 'flowchart LR', '  A --> B', '```', '', 'After.'].join('\n'),
    );
    expect(segments.map((s) => s.kind)).toEqual(['html', 'mermaid', 'html']);
    expect(segments[1]).toEqual({ kind: 'mermaid', source: 'flowchart LR\n  A --> B' });
  });

  it('keeps other fenced blocks as code', () => {
    expect(html(['```ts', 'const a = 1;', '```'].join('\n'))).toContain('<code class="language-ts">');
  });

  it('escapes raw HTML', () => {
    expect(html('<img src=x onerror="alert(1)">')).not.toContain('<img');
  });

  it('sends docs paths through docsUrl and opens every link in a new tab', () => {
    const out = html('See [the guide](/guide/reporter#setup) or [Playwright](https://playwright.dev).');
    expect(out).toContain(`href="${docsUrl('guide/reporter#setup')}" target="_blank" rel="noopener noreferrer"`);
    expect(out).toContain('href="https://playwright.dev" target="_blank"');
  });

  it('renders an unsafe or app-relative link as its label', () => {
    expect(html('[x](javascript:alert(1)) [y](/settings)')).not.toContain('<a');
  });
});

describe('HELP_TOPICS copy', () => {
  // Copy written as prose before hints were Markdown must not pick up markup by
  // accident: a stray `*` or `_` turning half a sentence italic.
  it.each(Object.entries(HELP_TOPICS))('%s renders without stray emphasis', (_key, topic) => {
    const out = html(topic.text);
    const intended = (topic.text.match(/\*\*[^*]+\*\*/g) ?? []).length;
    expect((out.match(/<strong>/g) ?? []).length).toBe(intended);
    expect(out).not.toContain('<em>');
  });
});
