import { describe, test, expect, vi, beforeEach } from 'vitest';

// Back the storage adapter with an in-memory file map so the whole inlining
// path (ZIP read → .trace/.network parse → resource reads) runs end to end
// without touching disk. `vi.hoisted` lets the factory below reach the map.
const { storageFiles } = vi.hoisted(() => ({ storageFiles: new Map<string, Buffer>() }));
vi.mock('../../server/storage', () => ({
  getStorage: () => ({
    readFile: async (path: string) => {
      const bytes = storageFiles.get(path);
      if (!bytes) throw new Error(`ENOENT: ${path}`);
      return bytes;
    },
  }),
}));

import { getTraceDomSnapshot } from '~~/server/utils/dom-snapshot';
import { buildZip } from '~~/server/utils/trace-zip';

/**
 * A minimal slim trace ZIP: one main-frame snapshot linking an external
 * stylesheet, and a `.network` stream mapping that stylesheet and its
 * background image to stored resources — the exact shape the picker inlines.
 */
function buildTraceZip(): Buffer {
  const frameSnapshot = {
    type: 'frame-snapshot',
    snapshot: {
      snapshotName: 's1',
      frameId: 'f1',
      isMainFrame: true,
      frameUrl: 'http://app.local/page',
      doctype: 'html',
      viewport: { width: 800, height: 600 },
      html: [
        'HTML',
        {},
        ['HEAD', {}, ['LINK', { rel: 'stylesheet', href: '/app.css' }]],
        ['BODY', {}, ['DIV', { class: 'logo' }, 'hi']],
      ],
    },
  };
  const resourceSnap = (url: string, sha1: string, mimeType: string) => ({
    type: 'resource-snapshot',
    snapshot: { request: { url }, response: { content: { _sha1: sha1, mimeType } } },
  });
  const network = [
    resourceSnap('http://app.local/app.css', 'css1', 'text/css'),
    resourceSnap('http://app.local/img/logo.png', 'img1', 'image/png'),
  ]
    .map((e) => JSON.stringify(e))
    .join('\n');
  return buildZip([
    { name: '0-trace.trace', data: Buffer.from(JSON.stringify(frameSnapshot), 'utf8') },
    { name: '0-trace.network', data: Buffer.from(network, 'utf8') },
  ]);
}

const BLOB = 'project-7/blobs/abc.zip';
const HEX_SECRET = 'a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2'; // 40 hex chars → masked
// The stylesheet references a background image by a document-relative url() and
// also carries a token-shaped secret, so one fixture exercises both concerns.
const CSS = `.logo{background:url(/img/logo.png)}.k{--t:"${HEX_SECRET}"}`;
const PNG = Buffer.from('PNGBYTES');

beforeEach(() => {
  storageFiles.clear();
  storageFiles.set(BLOB, buildTraceZip());
  storageFiles.set('project-7/trace-resources/css1', Buffer.from(CSS, 'utf8'));
  storageFiles.set('project-7/trace-resources/img1', PNG);
});

describe('getTraceDomSnapshot — stylesheet + asset inlining', () => {
  test('inlines the stylesheet, embeds its url() image as a data URI, and masks secrets last', async () => {
    const res = await getTraceDomSnapshot(BLOB, 1_000_000, { inlineStyles: true });
    expect(res.status).toBe('ok');
    // The <link> became an inline <style>.
    expect(res.html).toContain('<style>');
    expect(res.html).not.toContain('<link rel="stylesheet"');
    // The CSS url() now points at the base64-embedded image — proving assets are
    // inlined AND that the later secret-mask left the fresh data URI intact.
    expect(res.html).toContain(`url("data:image/png;base64,${PNG.toString('base64')}")`);
    // …while the token-shaped secret in the same sheet is still scrubbed.
    expect(res.html).toContain('[masked-hex]');
    expect(res.html).not.toContain(HEX_SECRET);
  });

  test('leaves the external <link> untouched when inlineStyles is off (the read-only card path)', async () => {
    const res = await getTraceDomSnapshot(BLOB, 1_000_000);
    expect(res.status).toBe('ok');
    expect(res.html).toContain('<link rel="stylesheet" href="/app.css">');
    expect(res.html).not.toContain('data:image/png');
  });

  test('keeps the <link> when the stylesheet resource is missing (graceful degradation)', async () => {
    storageFiles.delete('project-7/trace-resources/css1');
    const res = await getTraceDomSnapshot(BLOB, 1_000_000, { inlineStyles: true });
    expect(res.status).toBe('ok');
    expect(res.html).toContain('<link rel="stylesheet" href="/app.css">');
  });
});

/**
 * The same inlining path over a Playwright v9 trace: the frame snapshot is keyed
 * by `callId` + `phase` (no `snapshotName`) and the `.network` resource body is
 * named by `_file` (`resources/`-prefixed) instead of `_sha1`. This is the exact
 * shape that left the picker unstyled before the format was supported.
 */
function buildV9TraceZip(): Buffer {
  const before = { type: 'before', callId: 'call@8', startTime: 1, class: 'Frame', method: 'goto', pageId: 'p1' };
  const frameSnapshot = {
    type: 'frame-snapshot',
    snapshot: {
      callId: 'call@8',
      phase: 'after',
      frameId: 'f1',
      isMainFrame: true,
      frameUrl: 'http://app.local/page',
      doctype: 'html',
      viewport: { width: 800, height: 600 },
      html: [
        'HTML',
        {},
        ['HEAD', {}, ['LINK', { rel: 'stylesheet', href: '/app.css' }]],
        ['BODY', {}, ['DIV', { class: 'logo' }, 'hi']],
      ],
    },
  };
  const after = { type: 'after', callId: 'call@8', endTime: 2 };
  const resourceSnap = (url: string, file: string, mimeType: string) => ({
    type: 'resource-snapshot',
    snapshot: { request: { url }, response: { content: { _file: `resources/${file}`, mimeType } } },
  });
  const network = [
    resourceSnap('http://app.local/app.css', 'css1', 'text/css'),
    resourceSnap('http://app.local/img/logo.png', 'img1', 'image/png'),
  ]
    .map((e) => JSON.stringify(e))
    .join('\n');
  return buildZip([
    {
      name: '0-trace.trace',
      data: Buffer.from([before, frameSnapshot, after].map((e) => JSON.stringify(e)).join('\n'), 'utf8'),
    },
    { name: '0-trace.network', data: Buffer.from(network, 'utf8') },
  ]);
}

describe('getTraceDomSnapshot — Playwright v9 trace format', () => {
  beforeEach(() => {
    storageFiles.set(BLOB, buildV9TraceZip());
  });

  test('renders the v9 snapshot and inlines its stylesheet + url() asset', async () => {
    const res = await getTraceDomSnapshot(BLOB, 1_000_000, { inlineStyles: true });
    expect(res.status).toBe('ok');
    // The callId+phase frame snapshot rendered despite carrying no snapshotName.
    expect(res.html).toContain('<div class="logo">hi</div>');
    // The `_file`-named stylesheet inlined, image embedded as a data URI.
    expect(res.html).toContain('<style>');
    expect(res.html).not.toContain('<link rel="stylesheet"');
    expect(res.html).toContain(`url("data:image/png;base64,${PNG.toString('base64')}")`);
  });
});
