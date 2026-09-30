import { describe, test, expect } from 'vitest';
import { safeHttpUrl, isSafeLinkTarget } from '#shared/utils/safe-url';
import { inlineMarkdownHtml } from '../../app/utils/markdown-inline';

describe('safeHttpUrl', () => {
  test('keeps absolute http(s) URLs', () => {
    expect(safeHttpUrl('https://jira.example.com/browse/PROJ-1')).toBe('https://jira.example.com/browse/PROJ-1');
    expect(safeHttpUrl('http://ci.local/build/9')).toBe('http://ci.local/build/9');
  });

  test('drops script, data and malformed URLs', () => {
    expect(safeHttpUrl('javascript:alert(1)')).toBeNull();
    expect(safeHttpUrl('java\tscript:alert(1)')).toBeNull();
    expect(safeHttpUrl('data:text/html,<script>alert(1)</script>')).toBeNull();
    expect(safeHttpUrl('/relative/path')).toBeNull();
    expect(safeHttpUrl('')).toBeNull();
    expect(safeHttpUrl(null)).toBeNull();
  });
});

describe('isSafeLinkTarget', () => {
  test('allows http(s), mailto and same-site targets', () => {
    for (const href of ['https://a.example', 'http://a', 'mailto:a@b.c', '/api/files/x.png', '#top', '?tab=1']) {
      expect(isSafeLinkTarget(href)).toBe(true);
    }
  });

  test('refuses script URLs and protocol-relative ones', () => {
    for (const href of [
      'javascript:alert(1)',
      ' javascript:alert(1)',
      '//evil.example',
      'data:text/html,x',
      'vbscript:x',
    ]) {
      expect(isSafeLinkTarget(href)).toBe(false);
    }
  });
});

describe('inlineMarkdownHtml', () => {
  test('renders a safe link', () => {
    expect(inlineMarkdownHtml('see [the run](https://piwi.example/test-runs/1)')).toContain(
      '<a href="https://piwi.example/test-runs/1"',
    );
  });

  test('leaves a javascript: link as text', () => {
    const html = inlineMarkdownHtml('[r](javascript:alert%28document.domain%29)');
    expect(html).not.toContain('<a ');
    expect(html).toContain('[r](javascript:alert%28document.domain%29)');
  });

  test('cannot break out of the href attribute', () => {
    const html = inlineMarkdownHtml(
      `[x](#" onmouseover="location='javascript:alert%281%29'" style="position:fixed;inset:0)`,
    );
    expect(html).not.toMatch(/<a [^>]*onmouseover/);
    expect(html).not.toContain('"');
  });

  test('escapes raw HTML', () => {
    expect(inlineMarkdownHtml('<img src=x onerror=alert(1)>')).toBe('&lt;img src=x onerror=alert(1)&gt;');
  });
});
