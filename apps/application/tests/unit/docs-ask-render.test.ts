import { describe, test, expect } from 'vitest';
import { createRenderer } from '../../../docs/.vitepress/theme/ask-docs/render';

const render = createRenderer('/');

describe('createRenderer', () => {
  test('renders lists, code and tables the way the docs write them', () => {
    const html = render('- one\n- two\n\n`code`\n\n| A | B |\n|---|---|\n| 1 | 2 |');
    expect(html).toContain('<ul>');
    expect(html).toContain('<code>code</code>');
    expect(html).toContain('<div class="ask-table"><table>');
    expect(html).toContain('</table></div>');
  });

  test('raw HTML is shown as text, never as markup', () => {
    const html = render('<script>alert(1)</script> and <img src=x onerror=alert(1)>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('<img');
    expect(html).toContain('&lt;script&gt;');
  });

  test('an image is reduced to its alt text', () => {
    const html = render('![a dashboard](https://example.com/tracker.png)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('tracker.png');
    expect(html).toContain('a dashboard');
  });

  test('a path of the site becomes a link with the base, an outside address opens in a new tab', () => {
    const withBase = createRenderer('/docs/');
    expect(withBase('[page](/guide/ci#sharding)')).toContain('href="/docs/guide/ci#sharding"');
    const outside = render('[github](https://github.com/PiwiTests/platform)');
    expect(outside).toContain('href="https://github.com/PiwiTests/platform"');
    expect(outside).toContain('target="_blank"');
    expect(outside).toContain('rel="noopener noreferrer"');
  });

  test('a link that points nowhere is plain text', () => {
    expect(render('[relative](foo/bar) and [script](javascript:alert(1))')).not.toContain('<a ');
    expect(render('[relative](foo/bar)')).toContain('relative');
  });

  test('<br> breaks a line inside a table cell', () => {
    expect(render('| A |\n|---|\n| one<br>two |')).toContain('one<br>\ntwo');
  });

  test('a heading sits two levels lower than it is written', () => {
    expect(render('# Title')).toContain('<h3>Title</h3>');
    expect(render('#### Deep')).toContain('<h6>Deep</h6>');
  });

  test('a linked citation keeps its brackets', () => {
    expect(render('Use the switch [\\[1\\]](/guide/ai-provider).')).toContain('<a href="/guide/ai-provider">[1]</a>');
  });
});
