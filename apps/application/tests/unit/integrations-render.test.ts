import { describe, test, expect } from 'vitest';
import { doc, type IssueDocument } from '../../shared/integrations/document';
import { renderMarkdown } from '../../shared/integrations/render-markdown';
import { renderAdf, type AdfNode } from '../../shared/integrations/render-adf';

/** A fixture document exercising every node kind. */
function fixture(): IssueDocument {
  return doc()
    .heading(2, 'What happened')
    .paragraph('A ', { text: 'timeout', strong: true }, ' on ', { text: 'page.click', code: true })
    .facts([
      ['Error type', ['timeout']],
      ['Branch', [{ text: 'main', code: true }]],
      ['Empty', []],
    ])
    .bullets([['one'], [{ text: 'two', href: 'https://x.test' }]])
    .code('const a = 1;\n```nested```', 'ts')
    .table(['A', 'B'], [['a|1', 'b']])
    .rule()
    .paragraph({ text: 'Piwi-Cluster: 42', code: true })
    .build();
}

describe('renderMarkdown', () => {
  const md = renderMarkdown(fixture());

  test('renders headings, styled inlines and links', () => {
    expect(md).toContain('## What happened');
    expect(md).toContain('A **timeout** on `page.click`');
    expect(md).toContain('- [two](https://x.test)');
  });

  test('renders a facts node as a two-column table, dropping empty rows', () => {
    expect(md).toContain('| **Error type** | timeout |');
    expect(md).toContain('| **Branch** | `main` |');
    expect(md).not.toContain('Empty');
  });

  test('escapes triple backticks in code and pipes in table cells', () => {
    expect(md).toContain('```ts');
    expect(md).toContain('\\`\\`\\`nested\\`\\`\\`');
    expect(md).toContain('a\\|1');
  });

  test('ends with a single trailing newline', () => {
    expect(md.endsWith('\n')).toBe(true);
    expect(md.endsWith('\n\n')).toBe(false);
  });

  test('an empty document renders to just a newline', () => {
    expect(renderMarkdown({ nodes: [] })).toBe('\n');
  });
});

describe('renderAdf', () => {
  const adf = renderAdf(fixture());

  test('is a versioned doc', () => {
    expect(adf.type).toBe('doc');
    expect(adf.version).toBe(1);
    expect(Array.isArray(adf.content)).toBe(true);
  });

  function walk(node: AdfNode, out: AdfNode[] = []): AdfNode[] {
    out.push(node);
    for (const c of node.content ?? []) walk(c, out);
    return out;
  }
  const all = adf.content.flatMap((n) => walk(n));

  test('heading carries its level, codeBlock its language', () => {
    expect(all.find((n) => n.type === 'heading')?.attrs?.level).toBe(2);
    expect(all.find((n) => n.type === 'codeBlock')?.attrs?.language).toBe('ts');
  });

  test('marks map strong/code/link onto text nodes', () => {
    const strong = all.find((n) => n.type === 'text' && n.text === 'timeout');
    expect(strong?.marks?.some((m) => m.type === 'strong')).toBe(true);
    const link = all.find((n) => n.type === 'text' && n.text === 'two');
    expect(link?.marks?.find((m) => m.type === 'link')?.attrs?.href).toBe('https://x.test');
  });

  test('never emits an empty text node', () => {
    expect(all.some((n) => n.type === 'text' && !n.text)).toBe(false);
  });

  test('facts and table become table nodes with rows', () => {
    const tables = all.filter((n) => n.type === 'table');
    expect(tables.length).toBe(2);
    expect(tables[0]!.content?.every((r) => r.type === 'tableRow')).toBe(true);
  });

  test('an empty paragraph collapses to a paragraph with no content', () => {
    const out = renderAdf(doc().paragraph('').build());
    expect(out.content[0]).toEqual({ type: 'paragraph', content: [] });
  });
});
