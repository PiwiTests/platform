/**
 * The suite's trace: what Playwright 1.63 records for a long failing test with
 * `trace: 'on'`, screenshots and `snapshots: { dom, aria, screen }` — the
 * runner's stream, the browser context's stream with a DOM, aria and screen
 * snapshot around every action, the screencast, the network log with its
 * bodies and the call stacks. Its weight sits where a recorded trace's does: in
 * the screencast and the screenshots (incompressible images) and in the aria
 * trees (large, compressible JSON) that grow with the page as the test loads
 * more rows. The same inputs give the same bytes.
 *
 * The trace is uploaded through the real import, so it is stored the way any
 * uploaded trace is, and lands on the dataset's newest failing test: its page
 * carries that test's whole history as well as the trace.
 */
import { createHash } from 'node:crypto';
import { crc32, deflateRawSync } from 'node:zlib';
import { signIn } from './targets.mjs';

/** Step groups the test runs: each loads a page of rows, searches, and checks the row count. */
const GROUPS = 24;
const ROWS_PER_GROUP = 20;
const REQUESTS_PER_LOAD = 6;
const SCREENSHOT_BYTES = 40_000;
const SCREENCAST_FRAME_BYTES = 70_000;
const SCREENCAST_EVERY_MS = 150;
const PAGE_ID = 'page@3f0e5bd2a1c94c7e8d6f0b1a2c3d4e5f';
const FRAME_ID = 'frame@9a8b7c6d5e4f30211f2e3d4c5b6a7980';
const ORIGIN = 'http://shop.local';

/** A fixed-seed byte stream: the incompressible body of a screenshot or a screencast frame. */
function noise(length, seed) {
  const bytes = Buffer.alloc(length);
  let x = (seed * 2654435761) >>> 0 || 1;
  for (let i = 0; i < length; i += 4) {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    bytes.writeUInt32LE(x >>> 0, Math.min(i, length - 4));
  }
  return bytes;
}

const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const JPEG_SIGNATURE = Buffer.from([0xff, 0xd8, 0xff, 0xe0]);
const image = (signature, length, seed) => Buffer.concat([signature, noise(length - signature.length, seed)]);
const sha1 = (data) => createHash('sha1').update(data).digest('hex');
const jsonl = (events) => events.map((e) => JSON.stringify(e)).join('\n') + '\n';

/** A ZIP of `entries`, deflating the ones that shrink and storing the images, at a fixed timestamp. */
function zip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const { name, data } of entries) {
    const deflated = deflateRawSync(data);
    const method = deflated.length < data.length ? 8 : 0;
    const body = method === 8 ? deflated : data;
    const fileName = Buffer.from(name, 'utf8');
    const crc = crc32(data);
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(20, 4);
    header.writeUInt16LE(0x0800, 6);
    header.writeUInt16LE(method, 8);
    header.writeUInt32LE(0x00210000, 10);
    header.writeUInt32LE(crc, 14);
    header.writeUInt32LE(body.length, 18);
    header.writeUInt32LE(data.length, 22);
    header.writeUInt16LE(fileName.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(method, 10);
    central.writeUInt32LE(0x00210000, 12);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(body.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(fileName.length, 28);
    central.writeUInt32LE(offset, 42);
    locals.push(header, fileName, body);
    centrals.push(central, fileName);
    offset += header.length + fileName.length + body.length;
  }
  const directory = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, directory, end]);
}

const product = (n) => ({
  id: n,
  name: `Product ${n}`,
  price: (n * 7) % 100,
  description: `Lorem ipsum dolor sit amet, consectetur adipiscing elit ${n}. `.repeat(3),
});

/** The aria tree of the page holding `rows` rows of products. */
function ariaTree(rows, query) {
  return [
    { role: 'heading', name: 'Shop', level: 1, box: { x: 8, y: 21, width: 1264, height: 37 } },
    { role: 'button', name: 'Load more', box: { x: 8, y: 80, width: 80, height: 21 } },
    { role: 'textbox', name: 'Search', box: { x: 88, y: 80, width: 185, height: 21 }, text: query },
    {
      role: 'table',
      box: { x: 8, y: 101, width: 1264, height: 22 * rows },
      children: Array.from({ length: rows }, (_, n) => {
        const p = product(n);
        return {
          role: 'row',
          name: `${p.name} ${p.price} ${p.description}`,
          box: { x: 10, y: 103 + 22 * n, width: 1260, height: 22 },
          children: [
            { role: 'cell', name: p.name },
            { role: 'cell', name: String(p.price) },
            { role: 'cell', name: p.description },
            { role: 'cell', children: [{ role: 'button', name: 'Add' }] },
          ],
        };
      }),
    },
  ];
}

/** The DOM snapshot of the same page, in Playwright's node-array form; the newest rows are the ones it carries. */
function domSnapshot(callId, phase, rows, query) {
  const shown = Array.from({ length: Math.min(rows, 40) }, (_, k) => {
    const p = product(rows - 1 - k);
    return [
      'TR',
      {},
      ['TD', {}, p.name],
      ['TD', {}, String(p.price)],
      ['TD', {}, p.description],
      ['TD', {}, ['BUTTON', {}, 'Add']],
    ];
  });
  return {
    callId,
    phase,
    pageId: PAGE_ID,
    frameId: FRAME_ID,
    frameUrl: `${ORIGIN}/`,
    doctype: 'html',
    viewport: { width: 1280, height: 720 },
    html: [
      'HTML',
      {},
      ['HEAD', {}, ['LINK', { rel: 'stylesheet', href: '/app.css' }]],
      [
        'BODY',
        {},
        ['H1', {}, 'Shop'],
        ['BUTTON', { id: 'more' }, 'Load more'],
        ['INPUT', { 'aria-label': 'Search', __playwright_value_: query }],
        ['TABLE', { id: 'grid' }, ['TBODY', {}, ...shown]],
      ],
    ],
  };
}

/**
 * Build the trace ZIP for a test recorded at `wallTime` (epoch ms), titled
 * `file:line › suite › test` the way Playwright titles the browser context.
 */
export function buildPerfTrace({ title, filePath, line, wallTime }) {
  const specFile = `/ci/checkout-web/${filePath}`;
  const at = (lineOffset, column = 5) => [{ file: specFile, line: line + lineOffset, column }];
  const runner = [];
  const context = [];
  const network = [];
  const stacks = [];
  const entries = [];
  const resources = new Map();
  let clock = 1_000;
  let ids = 0;
  const nextId = () => ++ids;

  runner.push({
    version: 9,
    type: 'context-options',
    origin: 'testRunner',
    browserName: '',
    playwrightVersion: '1.63.0',
    options: {},
    platform: 'linux',
    wallTime,
    monotonicTime: clock,
    sdkLanguage: 'javascript',
    testTimeout: 30_000,
    annotations: [],
  });
  context.push({
    version: 9,
    type: 'context-options',
    origin: 'library',
    browserName: 'chromium',
    playwrightVersion: '1.63.0',
    options: { viewport: { width: 1280, height: 720 }, locale: 'en-US', colorScheme: 'light' },
    platform: 'linux',
    wallTime: wallTime + 400,
    monotonicTime: clock + 400,
    sdkLanguage: 'javascript',
    title,
  });
  clock += 500;

  let lastFrame = clock;
  const advance = (ms) => {
    clock += ms;
    for (; lastFrame + SCREENCAST_EVERY_MS <= clock; lastFrame += SCREENCAST_EVERY_MS) {
      const file = `screencast/${PAGE_ID}-${Math.round(wallTime + lastFrame)}.jpeg`;
      context.push({ type: 'screencast-frame', pageId: PAGE_ID, file, width: 1280, height: 720, timestamp: lastFrame });
      entries.push({ name: file, data: image(JPEG_SIGNATURE, SCREENCAST_FRAME_BYTES, lastFrame) });
    }
  };

  const request = (method, path, body, mimeType, status = 200) => {
    const bodyBytes = Buffer.from(body, 'utf8');
    const ext = mimeType.split('/')[1].replace('javascript', 'js');
    const name = `${sha1(bodyBytes)}.${ext}`;
    resources.set(name, bodyBytes);
    network.push({
      type: 'resource-snapshot',
      snapshot: {
        pageref: PAGE_ID,
        startedDateTime: new Date(wallTime + clock).toISOString(),
        time: 42,
        request: {
          method,
          url: `${ORIGIN}${path}`,
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: [
            { name: 'Accept', value: '*/*' },
            { name: 'Accept-Language', value: 'en-US' },
            { name: 'Authorization', value: 'Bearer perf-suite-token' },
            { name: 'User-Agent', value: 'Mozilla/5.0 (X11; Linux x86_64) HeadlessChrome/141.0.0.0 Safari/537.36' },
          ],
          queryString: [],
          headersSize: 320,
          bodySize: 0,
        },
        response: {
          status,
          statusText: status === 200 ? 'OK' : 'Accepted',
          httpVersion: 'HTTP/1.1',
          cookies: [],
          headers: [
            { name: 'content-type', value: mimeType },
            { name: 'content-length', value: String(bodyBytes.length) },
            { name: 'set-cookie', value: 'sid=perf; HttpOnly' },
          ],
          content: { size: bodyBytes.length, mimeType, _file: `resources/${name}` },
          headersSize: 120,
          bodySize: bodyBytes.length,
          redirectURL: '',
          _transferSize: bodyBytes.length + 120,
        },
        cache: {},
        timings: { dns: -1, connect: -1, ssl: -1, send: 0, wait: 30, receive: 12 },
        _frameref: FRAME_ID,
        _monotonicTime: clock,
        _resourceType: path.startsWith('/api/') ? 'fetch' : path === '/' ? 'document' : 'stylesheet',
      },
    });
  };

  /** One library call, its runner step, and the snapshots around it. */
  const action = ({ method, params, runner: step, rows, query, work, error, parentId, lineOffset }) => {
    const n = nextId();
    const callId = `call@${n}`;
    const stepId = `${step.method}@${nextId()}`;
    const stack = at(lineOffset, 14);
    runner.push({ type: 'before', callId: stepId, stepId, parentId, startTime: clock, class: 'Test', ...step, stack });
    stacks.push([n, [[0, stack[0].line, stack[0].column, '']]]);
    context.push({ type: 'before', callId, startTime: clock, class: 'Frame', method, params, stepId, pageId: PAGE_ID });
    const waitingFor = params.selector ? `waiting for ${params.selector}` : `navigating to "${params.url}"`;
    context.push({ type: 'log', callId, time: clock + 1, message: waitingFor });
    const snapshotsAt = (phase, pageRows) => {
      const aria = `aria/${callId}-${phase}.json`;
      const shot = `screenshots/${callId}-${phase}.png`;
      context.push({ type: 'screenshot', callId, phase, pageId: PAGE_ID, timestamp: clock, file: shot });
      context.push({ type: 'aria-snapshot', callId, phase, pageId: PAGE_ID, timestamp: clock, file: aria });
      context.push({ type: 'frame-snapshot', snapshot: domSnapshot(callId, phase, pageRows, query) });
      entries.push({ name: shot, data: image(PNG_SIGNATURE, SCREENSHOT_BYTES, n * 2 + (phase === 'after' ? 1 : 0)) });
      entries.push({ name: aria, data: Buffer.from(JSON.stringify(ariaTree(pageRows, query)), 'utf8') });
    };
    snapshotsAt('before', rows.before);
    advance(60);
    work?.();
    context.push({ type: 'log', callId, time: clock, message: `  ${error ? 'unexpected value' : 'done'}` });
    advance(error ? 5_000 : 180);
    const failure = error ? { error: { name: '', message: error } } : {};
    context.push({ type: 'after', callId, endTime: clock, ...failure });
    runner.push({ type: 'after', callId: stepId, endTime: clock, annotations: [], ...failure });
    snapshotsAt('after', rows.after);
    advance(40);
  };

  // Open the page.
  action({
    method: 'goto',
    params: { url: `${ORIGIN}/`, waitUntil: 'load' },
    runner: { method: 'pw:api', title: `Navigate to "${ORIGIN}/"`, params: { url: `${ORIGIN}/` } },
    rows: { before: 0, after: ROWS_PER_GROUP },
    query: '',
    lineOffset: 1,
    work: () => {
      request('GET', '/', '<!doctype html><html><body><h1>Shop</h1></body></html>', 'text/html');
      request('GET', '/app.css', 'td{padding:2px} .row{color:#333}\n'.repeat(300), 'text/css');
    },
  });

  const failureMessage =
    "Error: expect(locator).toHaveCount(expected) failed\n\nLocator:  locator('#grid tr')\n" +
    `Expected: ${(GROUPS + 2) * ROWS_PER_GROUP}\nReceived: ${(GROUPS + 1) * ROWS_PER_GROUP}\n\nCall log:\n` +
    "  - Expect \"toHaveCount\" locator('#grid tr') with timeout 5000ms\n  - waiting for locator('#grid tr')\n" +
    `    9 × locator resolved to ${(GROUPS + 1) * ROWS_PER_GROUP} elements\n`;

  for (let g = 0; g < GROUPS; g++) {
    const groupId = `test.step@${nextId()}`;
    const rows = (g + 1) * ROWS_PER_GROUP;
    const query = `query ${g}`;
    const last = g === GROUPS - 1;
    const groupStack = at(3);
    runner.push({
      type: 'before',
      callId: groupId,
      stepId: groupId,
      startTime: clock,
      class: 'Test',
      method: 'test.step',
      title: `load page ${g + 1}`,
      params: {},
      stack: groupStack,
    });
    action({
      method: 'click',
      params: { selector: 'internal:role=button[name="Load more"i]', strict: true },
      runner: { method: 'pw:api', title: 'Click', params: { locator: "getByRole('button', { name: 'Load more' })" } },
      rows: { before: rows, after: last ? rows : rows + ROWS_PER_GROUP },
      query: g ? `query ${g - 1}` : '',
      parentId: groupId,
      lineOffset: 4,
      work: () => {
        for (let k = 0; k < REQUESTS_PER_LOAD - 1; k++) {
          const items = Array.from({ length: 12 }, (_, j) => product(g * 60 + k * 12 + j));
          request('GET', `/api/products?page=${g}&k=${k}`, JSON.stringify({ items, page: g }), 'application/json');
          advance(15);
        }
        request('POST', '/api/events', JSON.stringify({ page: g, ok: true }), 'application/json', 202);
      },
    });
    const afterClick = last ? rows : rows + ROWS_PER_GROUP;
    action({
      method: 'fill',
      params: { selector: 'internal:label="Search"i', value: query, strict: true },
      runner: { method: 'pw:api', title: `Fill "${query}"`, params: { locator: "getByLabel('Search')", value: query } },
      rows: { before: afterClick, after: afterClick },
      query,
      parentId: groupId,
      lineOffset: 5,
    });
    action({
      method: 'expect',
      params: { selector: '#grid tr', expression: 'to.have.count', expectedNumber: rows + ROWS_PER_GROUP },
      runner: { method: 'expect', title: 'Expect "toHaveCount"', params: { locator: "locator('#grid tr')" } },
      rows: { before: afterClick, after: afterClick },
      query,
      parentId: groupId,
      lineOffset: 6,
      error: last ? failureMessage : undefined,
    });
    runner.push({
      type: 'after',
      callId: groupId,
      endTime: clock,
      annotations: [],
      ...(last ? { error: { name: '', message: failureMessage } } : {}),
    });
  }
  runner.push({ type: 'error', message: failureMessage, stack: at(6, 46) });

  for (let k = 0; k < 6; k++) {
    context.push({
      type: 'console',
      messageType: k % 3 ? 'log' : 'warning',
      text: k % 3 ? `loaded page ${k}` : `Slow response from /api/products (page ${k})`,
      location: { url: `${ORIGIN}/app.js`, lineNumber: 12 + k, columnNumber: 3 },
      time: 2_000 + k * 3_000,
      pageId: PAGE_ID,
    });
  }

  return zip([
    { name: 'test.trace', data: Buffer.from(jsonl(runner), 'utf8') },
    { name: '1-trace.trace', data: Buffer.from(jsonl(context), 'utf8') },
    { name: '1-trace.network', data: Buffer.from(jsonl(network), 'utf8') },
    { name: '1-trace.stacks', data: Buffer.from(JSON.stringify({ files: [specFile], stacks }), 'utf8') },
    ...entries,
    ...[...resources].map(([name, data]) => ({ name: `resources/${name}`, data })),
  ]);
}

/**
 * Upload the trace through the import, into the project its test belongs to;
 * returns the import's run id.
 */
export async function importPerfTrace(server, projectName, trace) {
  if (!server.cookie) await signIn(server);
  const form = new FormData();
  form.append('projectName', projectName);
  form.append('archive', new Blob([buildPerfTrace(trace)], { type: 'application/zip' }), 'trace.zip');
  const res = await fetch(`${server.base}/api/test-runs/import`, {
    method: 'POST',
    headers: { cookie: server.cookie },
    body: form,
  });
  if (!res.ok) throw new Error(`${server.name}: trace import failed (${res.status}): ${await res.text()}`);
  const result = await res.json();
  if (!result.runId) throw new Error(`${server.name}: trace import returned no run: ${JSON.stringify(result)}`);
  return result.runId;
}
