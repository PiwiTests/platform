import { describe, test, expect } from 'vitest';
import {
  renderSnapshotHtml,
  sanitizeDomSnapshot,
  extractDomSnapshot,
  collectStylesheetLinks,
  inlineStylesheets,
  collectCssUrls,
  inlineCssUrls,
  collectImageSources,
  inlineImageSources,
  mediaMatchesViewport,
  maskCssText,
} from '~~/server/utils/dom-snapshot-render';
import { resolveCaseDomSnapshot } from '~~/server/utils/dom-snapshot';
import { renderAriaSnapshotHtml } from '~~/server/utils/dom-snapshot-aria';
import {
  parseResourceSnapshots,
  parseTraceTexts,
  type TraceFrameSnapshot,
  type ParsedTraceData,
} from '~~/server/utils/trace-events';

function snap(overrides: Partial<TraceFrameSnapshot>): TraceFrameSnapshot {
  return { frameId: 'frame@1', isMainFrame: true, html: ['HTML', {}], ...overrides };
}

function traceData(frameSnapshots: TraceFrameSnapshot[]): ParsedTraceData {
  return {
    actions: [],
    consoleEntries: [],
    networkRequests: [],
    frameSnapshots,
    failingAction: null,
    failingActionIndex: -1,
    eventCount: 0,
    timeoutFallback: false,
    traceEndTime: 0,
  };
}

describe('renderSnapshotHtml', () => {
  test('renders a plain tree with attributes, text and void elements', () => {
    const html = renderSnapshotHtml(
      [
        snap({
          snapshotName: 'before@call@1',
          doctype: 'html',
          html: [
            'HTML',
            { lang: 'en' },
            [
              'BODY',
              {},
              ['H1', {}, 'Checkout'],
              ['INPUT', { id: 'email', type: 'email' }],
              ['DIV', { class: 'x' }, 'a < b'],
            ],
          ],
        }),
      ],
      'before@call@1',
    );
    expect(html).toBe(
      '<!DOCTYPE html>\n<html lang="en"><body><h1>Checkout</h1><input id="email" type="email"><div class="x">a &lt; b</div></body></html>',
    );
  });

  test('never emits __playwright_* attributes or inline handlers', () => {
    const html = renderSnapshotHtml(
      [
        snap({
          snapshotName: 's1',
          html: ['HTML', {}, ['BODY', {}, ['INPUT', { __playwright_value_: 'hunter2', id: 'pw', onclick: 'evil()' }]]],
        }),
      ],
      's1',
    );
    expect(html).toContain('<input id="pw">');
    expect(html).not.toContain('hunter2');
    expect(html).not.toContain('onclick');
  });

  test('drops tag and attribute names that would spill into the markup', () => {
    const html = renderSnapshotHtml(
      [
        snap({
          snapshotName: 's1',
          html: [
            'HTML',
            {},
            ['BODY', {}, ['DIV', { 'x onerror': 'alert(1)', id: 'ok' }], ['IMG SRC=X ONERROR=alert(1)', {}]],
          ],
        }),
      ],
      's1',
    );
    expect(html).toBe('<html><body><div id="ok"></div></body></html>');
  });

  test('drops script bodies but keeps the tag as a marker', () => {
    const html = renderSnapshotHtml(
      [snap({ snapshotName: 's1', html: ['HTML', {}, ['SCRIPT', {}, 'window.secret = "abc";']] })],
      's1',
    );
    expect(html).toBe('<html><script></script></html>');
  });

  test('empties an SVG <script> (recorded lower case) and drops its attributes', () => {
    const html = renderSnapshotHtml(
      [
        snap({
          snapshotName: 's1',
          html: ['HTML', {}, ['svg', {}, ['script', { href: '/evil.js' }, 'parent.postMessage("x", "*")']]],
        }),
      ],
      's1',
    );
    expect(html).toBe('<html><svg><script></script></svg></html>');
  });

  test('drops resource-hint links (modulepreload, preload, prefetch…) but keeps stylesheets and icons', () => {
    const html = renderSnapshotHtml(
      [
        snap({
          snapshotName: 's1',
          html: [
            'HTML',
            {},
            [
              'HEAD',
              {},
              ['LINK', { rel: 'modulepreload', crossorigin: '', href: '/dist/assets/chunk-a1.js' }],
              ['LINK', { rel: 'preload', as: 'font', href: '/font.woff2' }],
              ['LINK', { rel: 'dns-prefetch', href: '//cdn.example.com' }],
              ['LINK', { rel: 'stylesheet', crossorigin: '', href: '/dist/assets/index.css' }],
              ['LINK', { rel: 'icon', href: '/favicon.ico' }],
            ],
          ],
        }),
      ],
      's1',
    );
    expect(html).toBe(
      '<html><head><link rel="stylesheet" crossorigin="" href="/dist/assets/index.css"><link rel="icon" href="/favicon.ico"></head></html>',
    );
  });

  const styleHeavy = (): Parameters<typeof renderSnapshotHtml>[0] => [
    snap({
      snapshotName: 's1',
      html: [
        'HTML',
        {},
        ['HEAD', {}, ['STYLE', {}, '.a{color:red}'.repeat(500)], ['LINK', { rel: 'stylesheet', href: '/app.css' }]],
        ['BODY', {}, ['BUTTON', { style: 'color:blue' }, 'Go']],
      ],
    }),
  ];

  test('keeps inline <style> bodies by default (full fidelity)', () => {
    const html = renderSnapshotHtml(styleHeavy(), 's1');
    expect(html).toContain('.a{color:red}');
    expect(html).toContain('<link rel="stylesheet" href="/app.css">');
    expect(html).toContain('<button style="color:blue">Go</button>');
  });

  test('drops inline <style> bodies under dropStyles, keeping <link> and inline style attrs', () => {
    const html = renderSnapshotHtml(styleHeavy(), 's1', { dropStyles: true });
    expect(html).toContain('<style></style>');
    expect(html).not.toContain('color:red');
    expect(html).toContain('<link rel="stylesheet" href="/app.css">');
    expect(html).toContain('<button style="color:blue">Go</button>');
  });

  test('resolves back-references against the earlier snapshot of the same frame', () => {
    const first = snap({
      snapshotName: 's1',
      html: ['HTML', {}, ['BODY', {}, ['DIV', { id: 'stable' }, 'unchanged content']]],
    });
    // Post-order node list of s1: ['unchanged content', DIV, BODY, HTML] → DIV is index 1.
    const second = snap({
      snapshotName: 's2',
      html: ['HTML', {}, ['BODY', {}, [[1, 1]], ['P', {}, 'new']]],
    });
    const html = renderSnapshotHtml([first, second], 's2');
    expect(html).toBe('<html><body><div id="stable">unchanged content</div><p>new</p></body></html>');
  });

  test('resolves chained references (a ref whose target itself refs further back)', () => {
    const s1 = snap({ snapshotName: 's1', html: ['HTML', {}, ['DIV', {}, 'root text']] });
    // s1 nodes: ['root text', DIV, HTML] → DIV at 1
    const s2 = snap({ snapshotName: 's2', html: ['HTML', {}, ['MAIN', {}, [[1, 1]]]] });
    // s2 nodes (refs skipped): [MAIN, HTML] → MAIN at 0
    const s3 = snap({ snapshotName: 's3', html: ['HTML', {}, [[1, 0]]] });
    const html = renderSnapshotHtml([s1, s2, s3], 's3');
    expect(html).toBe('<html><main><div>root text</div></main></html>');
  });

  test('emits a placeholder for unresolvable references instead of failing', () => {
    const html = renderSnapshotHtml([snap({ snapshotName: 's1', html: ['HTML', {}, ['BODY', {}, [[5, 99]]]] })], 's1');
    expect(html).toBe('<html><body><!-- [unresolved snapshot reference] --></body></html>');
  });

  test('returns null for an unknown snapshot name', () => {
    expect(renderSnapshotHtml([snap({ snapshotName: 's1' })], 'nope')).toBeNull();
  });

  test('prefers the main-frame snapshot when an iframe shares the name', () => {
    const iframe = snap({
      snapshotName: 's1',
      frameId: 'frame@iframe',
      isMainFrame: false,
      html: ['HTML', {}, ['BODY', {}, 'iframe content']],
    });
    const main = snap({ snapshotName: 's1', html: ['HTML', {}, ['BODY', {}, 'main content']] });
    expect(renderSnapshotHtml([iframe, main], 's1')).toContain('main content');
  });
});

describe('collectStylesheetLinks', () => {
  test('returns unique stylesheet hrefs and ignores non-stylesheet links', () => {
    const html =
      '<head>' +
      '<link rel="stylesheet" href="/a.css">' +
      "<link rel='stylesheet' href='/b.css'>" +
      '<link rel="preload" as="style" href="/c.css">' + // not rel=stylesheet
      '<link rel="icon" href="/favicon.ico">' +
      '<link rel="stylesheet" href="/a.css">' + // dupe
      '<link rel="stylesheet">' + // no href
      '</head>';
    expect(collectStylesheetLinks(html)).toEqual([
      { href: '/a.css', media: null },
      { href: '/b.css', media: null },
    ]);
  });

  test('matches a stylesheet token among several rel values and a bare href', () => {
    expect(collectStylesheetLinks('<link rel="preload stylesheet" href=bare.css>')).toEqual([
      { href: 'bare.css', media: null },
    ]);
  });

  test('carries each link media query', () => {
    expect(
      collectStylesheetLinks('<link href="/m.css" rel="stylesheet" media="screen and (max-width: 599px)">'),
    ).toEqual([{ href: '/m.css', media: 'screen and (max-width: 599px)' }]);
  });
});

describe('mediaMatchesViewport', () => {
  const desktop = { width: 1280, height: 800 };

  test('reads min/max width and height bounds against the recorded viewport', () => {
    expect(mediaMatchesViewport('screen and (max-width: 599px)', desktop)).toBe(false);
    expect(mediaMatchesViewport('screen and (min-width: 600px) and (max-width: 1199px)', desktop)).toBe(false);
    expect(mediaMatchesViewport('screen and (min-width: 1200px)', desktop)).toBe(true);
    expect(mediaMatchesViewport('(min-width: 75em)', desktop)).toBe(true); // 1200px
    expect(mediaMatchesViewport('(max-height: 700px)', desktop)).toBe(false);
  });

  test('handles media types, comma lists, not and only', () => {
    expect(mediaMatchesViewport('print', desktop)).toBe(false);
    expect(mediaMatchesViewport('all', desktop)).toBe(true);
    expect(mediaMatchesViewport('print, (min-width: 1000px)', desktop)).toBe(true);
    expect(mediaMatchesViewport('not print', desktop)).toBe(true);
    expect(mediaMatchesViewport('only screen and (max-width: 600px)', desktop)).toBe(false);
  });

  test('counts a query it cannot read, or an unknown viewport, as applying', () => {
    expect(mediaMatchesViewport('(orientation: portrait)', desktop)).toBe(true);
    expect(mediaMatchesViewport('(width >= 2000px)', desktop)).toBe(true);
    expect(mediaMatchesViewport('screen and (max-width: 599px)')).toBe(true);
  });
});

describe('inlineStylesheets', () => {
  test('replaces matching stylesheet links in place, leaving unmatched ones alone', () => {
    const html = '<head><link rel="stylesheet" href="/app.css"><link rel="stylesheet" href="/missing.css"></head>';
    const out = inlineStylesheets(html, { '/app.css': 'body{color:red}' });
    expect(out).toContain('<style>body{color:red}</style>');
    expect(out).not.toContain('href="/app.css"');
    // Unknown sheet stays as a link (its href may still resolve; no worse off).
    expect(out).toContain('<link rel="stylesheet" href="/missing.css">');
  });

  test('preserves the media attribute on the inlined style', () => {
    const html = '<link rel="stylesheet" href="/print.css" media="print">';
    expect(inlineStylesheets(html, { '/print.css': 'a{}' })).toBe('<style media="print">a{}</style>');
  });

  test('defangs a stray </style> in the CSS so it cannot break out of the tag', () => {
    const css = '.x{content:"</style><script>alert(1)</script>"}';
    const out = inlineStylesheets('<link rel="stylesheet" href="x">', { x: css });
    expect(out).not.toContain('</style><script>'); // the closing tag can't break out
    expect(out).toContain('<\\/style>');
  });

  test('does NOT mask embedded data URIs — masking is the caller-side job before assets are inlined', () => {
    // inlineStylesheets is purely structural now; a base64 background image the
    // asset-inliner embedded must survive untouched (maskCssText scrubs secrets
    // beforehand, leaving data: URIs alone).
    const css = '.y{background:url("data:image/png;base64,iVBORw0KGgoAAAA==")}';
    expect(inlineStylesheets('<link rel="stylesheet" href="x">', { x: css })).toContain('iVBORw0KGgoAAAA==');
  });

  test('stops inlining once the CSS budget is spent, keeping later links intact', () => {
    const html = '<link rel="stylesheet" href="/a.css"><link rel="stylesheet" href="/b.css">';
    const out = inlineStylesheets(html, { '/a.css': 'aaaa', '/b.css': 'bbbb' }, 4);
    expect(out).toContain('<style>aaaa</style>'); // first fits the budget of 4
    expect(out).toContain('<link rel="stylesheet" href="/b.css">'); // second exceeds it → left as a link
  });

  test('is a no-op when there is nothing to inline', () => {
    expect(inlineStylesheets('<link rel="stylesheet" href="/a.css">', {})).toBe(
      '<link rel="stylesheet" href="/a.css">',
    );
  });
});

describe('parseResourceSnapshots', () => {
  const line = (url: string, sha1: string | null, mimeType?: string) =>
    JSON.stringify({
      type: 'resource-snapshot',
      snapshot: {
        request: { url },
        response: { content: sha1 ? { _sha1: sha1, ...(mimeType ? { mimeType } : {}) } : {} },
      },
    });

  test('maps resource URLs to their content hash + MIME, ignoring other events and lines without a hash', () => {
    const text = [
      line('http://app/main.css', 'aaa.css', 'text/css'),
      JSON.stringify({ type: 'context-options' }), // unrelated event
      'not json at all',
      line('http://app/no-hash.css', null), // response carries no _sha1
    ].join('\n');
    const map = parseResourceSnapshots([text]);
    expect(map.get('http://app/main.css')).toEqual({ sha1: 'aaa.css', mimeType: 'text/css' });
    expect(map.has('http://app/no-hash.css')).toBe(false);
    expect(map.size).toBe(1);
  });

  test('records an undefined MIME when the response did not carry one', () => {
    expect(parseResourceSnapshots([line('http://app/x.woff2', 'f.woff2')]).get('http://app/x.woff2')).toEqual({
      sha1: 'f.woff2',
      mimeType: undefined,
    });
  });

  test('later snapshots win for a repeated URL', () => {
    const text = [line('http://app/x.css', 'old.css'), line('http://app/x.css', 'new.css')].join('\n');
    expect(parseResourceSnapshots([text]).get('http://app/x.css')?.sha1).toBe('new.css');
  });

  test('reads the v9 `_file` body ref (resources/-prefixed) as well as the v8 `_sha1`', () => {
    // Playwright's current trace format renamed `_sha1` to `_file` and prefixes
    // the ZIP directory; both must reduce to the same bare pool/zip filename.
    const v9 = JSON.stringify({
      type: 'resource-snapshot',
      snapshot: {
        request: { url: 'http://app/app.css' },
        response: { content: { _file: 'resources/26b1a9ce.css', mimeType: 'text/css' } },
      },
    });
    expect(parseResourceSnapshots([v9]).get('http://app/app.css')).toEqual({
      sha1: '26b1a9ce.css',
      mimeType: 'text/css',
    });
  });
});

describe('collectCssUrls / inlineCssUrls', () => {
  test('counts each url() target, skipping data:, #fragment and fragment-addressed refs', () => {
    const css =
      '@font-face{src:url("/f/inter.woff2") format("woff2")}' +
      '.a{background:url(/img/bg.png)}' +
      ".b{background:url('/img/bg.png')}" + // dupe of the same target
      '.c{background:url(data:image/gif;base64,AAAA)}' + // already inline
      '.d{filter:url(#blur)}' + // in-document ref
      '.e{background:url(/img/sprite.svg#star)}'; // fragment-addressed — can't inline faithfully
    expect([...collectCssUrls(css)]).toEqual([
      ['/f/inter.woff2', 1],
      ['/img/bg.png', 2],
    ]);
  });

  test('rewrites only the targets present in the replacement map, double-quoting them', () => {
    const css = ".a{background:url(/img/bg.png)}.b{src:url('/f/x.woff2')}";
    const out = inlineCssUrls(css, { '/img/bg.png': 'data:image/png;base64,PNG' });
    expect(out).toContain('url("data:image/png;base64,PNG")');
    expect(out).toContain("url('/f/x.woff2')"); // untouched — no replacement supplied
  });
});

describe('collectImageSources / inlineImageSources', () => {
  const html =
    '<img src="/a.png" alt="A"><img alt="x > y" src="/q.png?w=1&amp;h=2">' +
    '<img src="/a.png"><img src="data:image/gif;base64,AAAA"><p src="/not-an-img.png"></p>';

  test('counts each <img src> URL, unescaped, skipping data: URIs and other tags', () => {
    expect([...collectImageSources(html)]).toEqual([
      ['/a.png', 2],
      ['/q.png?w=1&h=2', 1],
    ]);
  });

  test('rewrites only the sources present in the replacement map', () => {
    const out = inlineImageSources(html, { '/q.png?w=1&h=2': 'data:image/png;base64,Q' });
    expect(out).toContain('<img alt="x > y" src="data:image/png;base64,Q">');
    expect(out).toContain('<img src="/a.png" alt="A">');
  });
});

describe('maskCssText', () => {
  test('scrubs JWT/long-hex secrets but leaves data: URIs alone', () => {
    const css =
      '.a{--t:"eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpM"}' +
      '.b{content:"4a7d1ed414474e4033ac29ccb8653d9b4a7d1ed414474e40"}' +
      '.c{background:url("data:image/png;base64,iVBORw0KGgoAAAA==")}';
    const out = maskCssText(css);
    expect(out).toContain('[masked-token]');
    expect(out).toContain('[masked-hex]');
    expect(out).toContain('data:image/png;base64,iVBORw0KGgoAAAA=='); // asset preserved
  });

  test('never masks inside an embedded data: URI — a zero run reads as long hex', () => {
    // 30 zero bytes encode as forty 'A's, which the case-insensitive hex mask matches.
    const b64 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.alloc(30), Buffer.from([0xfb, 0xff])]).toString(
      'base64',
    );
    const css = `@font-face{src:url("data:font/woff2;base64,${b64}")}`;
    expect(maskCssText(css)).toBe(css);
  });
});

describe('sanitizeDomSnapshot', () => {
  test('masks base64 data URIs, JWTs and long hex tokens', () => {
    const input =
      '<img src="data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==">' +
      '<div data-auth="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0In0.SflKxwRJSMeKKF2QT4fwpM">' +
      '<span>4a7d1ed414474e4033ac29ccb8653d9b4a7d1ed414474e40</span>';
    const { html, truncated } = sanitizeDomSnapshot(input, 10_000);
    expect(html).toContain('data:[masked]');
    expect(html).toContain('[masked-token]');
    expect(html).toContain('[masked-hex]');
    expect(html).not.toContain('iVBORw0KGgo');
    expect(html).not.toContain('eyJhbGciOiJIUzI1NiI');
    expect(truncated).toBe(false);
  });

  test('caps the output with a truncation marker', () => {
    const { html, truncated } = sanitizeDomSnapshot('<div>' + 'x'.repeat(500) + '</div>', 100);
    expect(truncated).toBe(true);
    expect(html.length).toBeLessThan(150);
    expect(html).toContain('<!-- [truncated] -->');
  });

  describe('keepInlineImages (the rendered page views)', () => {
    const zeroRun = Buffer.concat([Buffer.from([0x89, 0x50]), Buffer.alloc(30), Buffer.from([0x4e, 0x47])]).toString(
      'base64',
    );
    const png = `data:image/png;base64,${zeroRun}`;

    test('keeps inline data:image URIs intact, masking everything else as usual', () => {
      const input =
        `<img src="${png}"><div style="background:url(${png})"></div>` +
        '<a href="data:application/pdf;base64,JVBERi0xLjQK">pdf</a>' +
        '<span>4a7d1ed414474e4033ac29ccb8653d9b4a7d1ed414474e40</span>';
      const { html } = sanitizeDomSnapshot(input, 10_000, { keepInlineImages: true });
      expect(html).toBe(
        `<img src="${png}"><div style="background:url(${png})"></div>` +
          '<a href="data:[masked]">pdf</a><span>[masked-hex]</span>',
      );
    });

    test('masks an inline image over the per-image limit', () => {
      const huge = `data:image/png;base64,${'Q'.repeat(250_000)}`;
      const { html } = sanitizeDomSnapshot(`<img src="${huge}">`, 1_000_000, { keepInlineImages: true });
      expect(html).toBe('<img src="data:[masked]">');
    });

    test('kept images do not count against the cap, and one the cap cuts off is dropped', () => {
      const big = `data:image/png;base64,${'Q'.repeat(150_000)}`;
      const fits = sanitizeDomSnapshot(`<p>a</p><img src="${big}">`, 100, { keepInlineImages: true });
      expect(fits.truncated).toBe(false);
      expect(fits.html).toContain(big);
      const cut = sanitizeDomSnapshot(`<p>${'x'.repeat(200)}</p><img src="${big}">`, 100, { keepInlineImages: true });
      expect(cut.truncated).toBe(true);
      expect(cut.html).not.toContain('\u0000');
    });
  });
});

describe('renderAriaSnapshotHtml', () => {
  test('renders each node with data-role/data-name plus real ARIA attrs for the picker', () => {
    const html = renderAriaSnapshotHtml('- button "Submit"\n- heading "Title" [level=2]')!;
    expect(html).toContain('data-role="button"');
    expect(html).toContain('data-name="Submit"');
    // Real ARIA attributes so the picker probe resolves getByRole('button', { name }).
    expect(html).toContain('role="button"');
    expect(html).toContain('aria-label="Submit"');
    expect(html).toContain('data-role="heading"');
    expect(html).toContain('aria-level="2"');
    // Rendered as a tree, not a flat list.
    expect(html).toContain('pw-node');
  });

  test('nests children under their parent inside a tree container', () => {
    const html = renderAriaSnapshotHtml('- navigation "Main":\n  - link "Home"\n  - link "About"')!;
    const body = html.slice(html.indexOf('<body>'));
    // The parent row is followed by a children container holding both links.
    expect(body).toMatch(/data-name="Main"[^]*pw-children[^]*data-name="Home"[^]*data-name="About"/);
    expect((body.match(/data-role="link"/g) ?? []).length).toBe(2);
  });

  test('renders a heading state marker as a badge without polluting the name', () => {
    const html = renderAriaSnapshotHtml('- button "Save" [disabled]')!;
    expect(html).toContain('data-name="Save"');
    expect(html).toContain('data-badges="disabled"');
  });

  test('renders text nodes as pickable text (getByText) with no role locator', () => {
    const html = renderAriaSnapshotHtml('- text: Hello world')!;
    expect(html).toContain('data-pw-text');
    expect(html).toContain('data-pw-pick');
    expect(html).toContain('Hello world');
    // No aria-label / standalone role attribute (getByRole) for a bare text node.
    const body = html.slice(html.indexOf('<body>'));
    expect(body).not.toContain('aria-label=');
    expect(body).not.toMatch(/\srole=/); // data-role is fine; a real `role=` is not
  });

  test('does not leak its own styling classes onto pickable rows (no class= to probe)', () => {
    // The picker probes the picked element's `class`; ARIA rows must carry none,
    // or every pick would offer a bogus `locator('.pw-row')` alternative.
    const html = renderAriaSnapshotHtml('- button "Go"')!;
    const body = html.slice(html.indexOf('<body>'));
    expect(body).not.toContain('class=');
  });

  test('hoists nameless generic wrappers so their children stay at the top level', () => {
    const html = renderAriaSnapshotHtml('- generic:\n  - button "Go"')!;
    expect(html).toContain('data-role="button"');
    expect(html).not.toContain('data-role="generic"');
  });

  test('returns null when the ARIA snapshot yields no candidates', () => {
    expect(renderAriaSnapshotHtml('')).toBeNull();
    expect(renderAriaSnapshotHtml('not a yaml list at all')).toBeNull();
  });

  test('escapes the untrusted accessible name in both text and attribute contexts', () => {
    // `<` would inject markup into the chip text; `"` would break out of data-name.
    const html = renderAriaSnapshotHtml('- button "a\\"b<img src=x onerror=alert(1)>"')!;
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x');
    expect(html).toContain('data-name="a&quot;b'); // quote escaped inside the attribute
  });

  // The demo picker renders these seeded ARIA snapshots (scripts/generate-demo-seed.mjs
  // `ariaSnapshotForCluster`) for failure clusters without a trace. Verify the exact
  // shapes — nested indentation, `[disabled]` markers, trailing `:` — parse into the
  // pickable chips the picker needs, so trace-less clusters aren't blank in the demo.
  test('renders the seeded strict-mode cluster snapshot into pickable button chips', () => {
    const html = renderAriaSnapshotHtml(
      '- document:\n  - button "Primary"\n  - button "Disabled" [disabled]\n  - button "Loading"',
    )!;
    expect(html).toContain('data-name="Primary"');
    expect(html).toContain('data-name="Disabled"'); // the `[disabled]` marker is ignored
    expect(html).toContain('data-name="Loading"');
    expect((html.match(/data-role="button"/g) ?? []).length).toBe(3);
  });

  test('renders the seeded getByLabel checkout cluster snapshot into pickable field chips', () => {
    const html = renderAriaSnapshotHtml(
      '- document:\n  - form "Checkout":\n    - combobox "Contact method"\n' +
        '    - textbox "Card number"\n    - textbox "Expiry date"\n    - textbox "CVV"\n    - button "Pay"',
    )!;
    expect(html).toContain('data-role="combobox"');
    expect(html).toContain('data-name="Contact method"');
    expect((html.match(/data-role="textbox"/g) ?? []).length).toBe(3);
    expect(html).toContain('data-name="Pay"');
  });
});

describe('resolveCaseDomSnapshot', () => {
  test('falls back to the ARIA tree when there is no trace', async () => {
    const res = await resolveCaseDomSnapshot(null, '- button "Go"');
    expect(res.status).toBe('ok');
    expect(res.snapshotName).toBe('aria-fallback');
    expect(res.source).toBe('aria');
    expect(res.availableSources).toEqual(['aria']);
    expect(res.html).toContain('data-role="button"');
  });

  test('source:aria renders the ARIA tree without parsing the trace, and lists both sources', async () => {
    // A trace path is present, but source:aria short-circuits before touching it,
    // so the toggle can still offer to switch back to the DOM view.
    const res = await resolveCaseDomSnapshot('demo/trace.zip', '- button "Go"', undefined, { source: 'aria' });
    expect(res.status).toBe('ok');
    expect(res.source).toBe('aria');
    expect(res.availableSources).toEqual(['dom', 'aria']);
    expect(res.html).toContain('data-role="button"');
  });

  test('returns no-trace when neither a trace nor an ARIA snapshot exists', async () => {
    expect((await resolveCaseDomSnapshot(null, null)).status).toBe('no-trace');
    expect((await resolveCaseDomSnapshot(null, 'no candidates here')).status).toBe('no-trace');
  });
});

describe('extractDomSnapshot — styled/lean two-pass', () => {
  // A page whose inline <style> dwarfs the body, with the body content last.
  const bigStyle = '.x{color:red}'.repeat(4000); // ~52k chars
  const page = (): TraceFrameSnapshot[] => [
    snap({
      snapshotName: 'after@call@1',
      viewport: { width: 1280, height: 720 },
      html: ['HTML', {}, ['HEAD', {}, ['STYLE', {}, bigStyle]], ['BODY', {}, ['BUTTON', {}, 'Click me']]],
    }),
  ];

  test('keeps inline styles when the styled render fits under the cap, and returns the viewport', () => {
    const res = extractDomSnapshot(traceData(page()), 1_000_000);
    expect(res.status).toBe('ok');
    expect(res.truncated).toBe(false);
    expect(res.html).toContain('.x{color:red}'); // styles preserved
    expect(res.html).toContain('<button>Click me</button>');
    expect(res.viewport).toEqual({ width: 1280, height: 720 });
  });

  test('surfaces the frame URL of the rendered snapshot (the base for stylesheet inlining)', () => {
    const frames: TraceFrameSnapshot[] = [
      snap({
        snapshotName: 'after@call@1',
        frameUrl: 'http://127.0.0.1:42589/checkout',
        html: ['HTML', {}, ['BODY', {}, ['BUTTON', {}, 'Pay']]],
      }),
    ];
    expect(extractDomSnapshot(traceData(frames), 1_000_000).frameUrl).toBe('http://127.0.0.1:42589/checkout');
  });

  test('falls back to a lean render (styles dropped) so the body survives a tiny cap', () => {
    // Cap smaller than the inline CSS — a styled render would truncate the body away.
    const res = extractDomSnapshot(traceData(page()), 5_000);
    expect(res.status).toBe('ok');
    expect(res.truncated).toBe(false); // lean render fits
    expect(res.html).toContain('<style></style>'); // CSS dropped
    expect(res.html).not.toContain('.x{color:red}');
    expect(res.html).toContain('<button>Click me</button>'); // body preserved
  });
});

describe('parseTraceTexts — v9 frame snapshots (callId + phase)', () => {
  // Playwright's current trace format identifies a frame snapshot by callId +
  // phase and no longer carries a `snapshotName`, nor snapshot pointers on the
  // before/after events. The parser must rebuild the v8 `${phase}@${callId}`
  // name so the failure-time DOM still renders.
  const v9Trace = (): string[] => {
    const events = [
      { type: 'before', callId: 'call@8', startTime: 100, class: 'Frame', method: 'goto', pageId: 'p1' },
      {
        type: 'frame-snapshot',
        snapshot: {
          callId: 'call@8',
          phase: 'after',
          frameId: 'f1',
          isMainFrame: true,
          frameUrl: 'http://127.0.0.1:42103/',
          html: ['HTML', {}, ['BODY', {}, ['H1', { class: 'headline' }, 'Styled']]],
        },
      },
      { type: 'after', callId: 'call@8', endTime: 200 },
      { type: 'before', callId: 'call@12', startTime: 300, class: 'Frame', method: 'click', pageId: 'p1' },
      {
        type: 'frame-snapshot',
        snapshot: {
          callId: 'call@12',
          phase: 'before',
          frameId: 'f1',
          isMainFrame: true,
          frameUrl: 'http://127.0.0.1:42103/',
          html: ['HTML', {}, ['BODY', {}, ['BUTTON', { id: 'go' }, 'Go']]],
        },
      },
      { type: 'after', callId: 'call@12', endTime: 900, error: { message: 'Timeout 800ms exceeded.' } },
    ];
    return [events.map((e) => JSON.stringify(e)).join('\n')];
  };

  test('synthesizes `${phase}@${callId}` snapshot names and before/after action pointers', () => {
    const data = parseTraceTexts(v9Trace());
    expect(data.frameSnapshots.map((s) => s.snapshotName)).toEqual(['after@call@8', 'before@call@12']);
    expect(data.failingAction?.callId).toBe('call@12');
    expect(data.failingAction?.beforeSnapshot).toBe('before@call@12');
    expect(data.failingAction?.afterSnapshot).toBe('after@call@12');
  });

  test('extractDomSnapshot renders the failing action’s before-snapshot from a v9 trace', () => {
    const res = extractDomSnapshot(parseTraceTexts(v9Trace()), 1_000_000);
    expect(res.status).toBe('ok');
    expect(res.snapshotName).toBe('before@call@12');
    expect(res.html).toContain('<button id="go">Go</button>');
    expect(res.frameUrl).toBe('http://127.0.0.1:42103/');
  });
});
