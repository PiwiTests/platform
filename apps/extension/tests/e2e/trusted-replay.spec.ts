import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import {
  clickInShadow,
  debuggerAttached,
  expect,
  expectText,
  finished,
  panelNode,
  type DomNode,
  replayState,
  startReplay,
  step,
  stepsDoc,
  tabIdOf,
  target,
  test,
} from './trusted-site.js';

/**
 * The replay with the real extension: trusted input through `chrome.debugger`
 * where the browser has it, the page's own events when the session is
 * cancelled. Each page reports what it received: whether an event was
 * trusted, whether the element really matched `:hover`.
 */

const LAB = `<!doctype html><html><head><style>
  body { font: 14px sans-serif; margin: 40px; }
  #menu { padding: 12px; border: 1px solid #999; width: 200px; }
  #drag { width: 80px; height: 40px; background: #ddd; }
  #drop { width: 200px; height: 80px; border: 2px dashed #999; margin-top: 20px; }
  #editor { border: 1px solid #999; min-height: 30px; width: 300px; }
</style></head><body>
  <div id="menu" data-testid="menu">Menu</div>
  <output data-testid="hovered">no</output>
  <button data-testid="twice">Open</button>
  <output data-testid="twice-result">none</output>
  <div id="drag" data-testid="card" draggable="true">Card</div>
  <div id="drop" data-testid="bin">Drop here</div>
  <output data-testid="dropped">nothing</output>
  <input type="date" data-testid="due" aria-label="Due" />
  <output data-testid="due-result">none</output>
  <div id="editor" contenteditable="true" data-testid="editor" aria-label="Notes"></div>
  <output data-testid="editor-result">none</output>
  <input type="file" data-testid="upload" aria-label="Attachment" />
  <output data-testid="upload-result">none</output>
<script>
  const out = (id, text) => {
    const el = document.querySelector('[data-testid="' + id + '"]');
    if (el.textContent !== text) el.textContent = text;
  };
  const menu = document.getElementById('menu');
  // Only a real pointer puts an element under :hover; a replay's own events cannot.
  setInterval(() => out('hovered', menu.matches(':hover') ? 'hover: real' : 'no'), 50);
  document.querySelector('[data-testid="twice"]').addEventListener('dblclick', (e) =>
    out('twice-result', e.isTrusted ? 'double click: trusted' : 'double click: script'));
  const card = document.getElementById('drag');
  card.addEventListener('dragstart', (e) => e.dataTransfer.setData('text/plain', 'card'));
  const bin = document.getElementById('drop');
  bin.addEventListener('dragover', (e) => e.preventDefault());
  bin.addEventListener('drop', (e) => {
    e.preventDefault();
    out('dropped', (e.isTrusted ? 'trusted: ' : 'script: ') + e.dataTransfer.getData('text/plain'));
  });
  document.querySelector('[data-testid="due"]').addEventListener('change', (e) => out('due-result', e.target.value));
  const editor = document.getElementById('editor');
  let kind = '';
  editor.addEventListener('beforeinput', (e) => (kind = (e.isTrusted ? 'trusted ' : 'script ') + e.inputType));
  editor.addEventListener('input', () => out('editor-result', kind + ': ' + editor.textContent));
  document.querySelector('[data-testid="upload"]').addEventListener('change', (e) => {
    const f = e.target.files[0];
    out('upload-result', f ? f.name + ' (' + f.size + ' bytes)' : 'none');
  });
</script></body></html>`;

const CLICKS = `<!doctype html><html><body>
  <button data-testid="first">First</button>
  <button data-testid="second">Second</button>
  <output data-testid="log"></output>
<script>
  const log = document.querySelector('[data-testid="log"]');
  for (const b of document.querySelectorAll('button'))
    b.addEventListener('click', (e) => (log.textContent += b.textContent + (e.isTrusted ? ' trusted; ' : ' script; ')));
</script></body></html>`;

/** A page that shows its viewport's size. */
const SIZED = `<!doctype html><html><head><meta charset="utf-8"></head><body><output data-testid="size"></output>
<script>
  const show = () => (document.querySelector('[data-testid="size"]').textContent = innerWidth + '×' + innerHeight);
  show();
  addEventListener('resize', show);
</script></body></html>`;

test.use({ pages: { '/lab': LAB, '/clicks': CLICKS, '/sized': SIZED } });

const hasAttribute = (name: string) => (node: DomNode) => {
  const attrs = node.attributes ?? [];
  for (let i = 0; i < attrs.length; i += 2) if (attrs[i] === name) return true;
  return false;
};

/** The replay panel's own file field, inside its closed shadow root, set as a person's choice sets it. */
async function chooseInReplayPanel(page: Page, file: string): Promise<void> {
  // The panel draws the field once the step has found its element, after the position moved on to it.
  await expect.poll(() => panelNode(page, hasAttribute('data-piwi-replay-file')), { timeout: 20_000 }).not.toBeNull();
  const backendNodeId = await panelNode(page, hasAttribute('data-piwi-replay-file'));
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('DOM.setFileInputFiles', { files: [file], backendNodeId: backendNodeId! });
  await cdp.detach();
}

test('replays with trusted input: a real hover, a double click, a drag and drop, a date, a rich text editor and a file', async ({
  context,
  control,
  site,
  worker,
}) => {
  const url = `${site}/lab`;
  const doc = stepsDoc('Trusted', site, [
    step('goto', '/lab', { value: '/lab' }),
    step('hover', '/lab', { target: target('menu') }),
    expectText('/lab', 'hovered', 'hover: real'),
    step('dblclick', '/lab', { target: target('twice', 'button', 'Open') }),
    expectText('/lab', 'twice-result', 'double click: trusted'),
    step('dragTo', '/lab', { target: target('card'), dropTarget: target('bin') }),
    expectText('/lab', 'dropped', 'trusted: card'),
    step('fill', '/lab', { target: target('due', 'textbox', 'Due'), value: '2026-09-28' }),
    expectText('/lab', 'due-result', '2026-09-28'),
    step('fill', '/lab', { target: target('editor', 'textbox', 'Notes'), value: 'Hello there' }),
    expectText('/lab', 'editor-result', 'trusted insertText: Hello there'),
    step('setInputFiles', '/lab', { target: target('upload', 'button', 'Attachment'), value: 'note.txt' }),
    expectText('/lab', 'upload-result', 'note.txt (5 bytes)'),
  ]);
  const page = await startReplay(control, context, site, doc, '/lab');
  const tabId = await tabIdOf(worker, url);

  // The file step waits for the developer to choose the file the report names.
  await expect.poll(async () => (await replayState(worker)).position, { timeout: 45_000 }).toBe(11);
  await expect.poll(() => debuggerAttached(worker, tabId)).toBe(true);
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'piwi-file-')), 'note.txt');
  writeFileSync(file, 'hello');
  await chooseInReplayPanel(page, file);

  const state = await finished(worker);
  expect(state.results.map((r) => r.status)).toEqual([
    'done',
    'done',
    'passed',
    'done',
    'passed',
    'done',
    'passed',
    'done',
    'passed',
    'done',
    'passed',
    'done',
    'passed',
  ]);
  expect(state.driver).toEqual({ driver: 'cdp', reason: null });
  expect(state.results.filter((r) => r.driver).map((r) => r.driver)).toEqual(['cdp', 'cdp', 'cdp', 'cdp', 'cdp']);
  expect(state.results[11]!.detail).toContain('note.txt');
  // The session is let go with the replay: the debugging bar does not stay.
  await expect.poll(() => debuggerAttached(worker, tabId)).toBe(false);
});

test('a file step can be skipped, and the verdict says the step was left out', async ({
  context,
  control,
  site,
  worker,
}) => {
  const doc = stepsDoc('Skip', site, [
    step('goto', '/lab', { value: '/lab' }),
    step('setInputFiles', '/lab', { target: target('upload', 'button', 'Attachment'), value: 'a.pdf\nb.pdf' }),
  ]);
  const page = await startReplay(control, context, site, doc, '/lab');
  await expect.poll(async () => (await replayState(worker)).position, { timeout: 45_000 }).toBe(1);
  await expect.poll(() => panelNode(page, hasAttribute('data-piwi-replay-file')), { timeout: 20_000 }).not.toBeNull();
  await clickInShadow(page, 'Skip this step');
  const state = await finished(worker);
  expect(state.results.map((r) => r.status)).toEqual(['done', 'skipped']);
});

test('after the debugging bar is cancelled, the replay goes on with the page’s own events and says so', async ({
  context,
  control,
  site,
  worker,
}) => {
  const url = `${site}/clicks`;
  const doc = stepsDoc('Cancel', site, [
    step('goto', '/clicks', { value: '/clicks' }),
    step('click', '/clicks', { target: target('first', 'button', 'First') }),
    step('click', '/clicks', { target: target('second', 'button', 'Second') }),
    expectText('/clicks', 'log', 'First trusted; Second script;'),
  ]);
  const page = await startReplay(control, context, site, doc, '/clicks', true);
  const tabId = await tabIdOf(worker, url);
  const next = () =>
    worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'piwi-replay-wake', wake: true }), tabId);

  await expect.poll(async () => (await replayState(worker)).driver?.driver, { timeout: 30_000 }).toBe('cdp');
  await expect.poll(async () => (await replayState(worker)).position).toBe(1);
  // The goto reloads the page, and the loop starting there forgets a Next sent before it: wait until that loop has
  // drawn its cursor in the reloaded page.
  await expect
    .poll(
      () =>
        page
          .evaluate(
            () =>
              (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ===
                'reload' && document.getElementById('piwi-replay-cursor-host') !== null,
          )
          .catch(() => false),
      { timeout: 20_000 },
    )
    .toBe(true);
  await next();
  await expect.poll(async () => (await replayState(worker)).position).toBe(2);
  // The position moves on before the step acts: the first click has to land before the bar is cancelled.
  await expect(page.getByTestId('log')).toHaveText('First trusted;');
  // The person clicks Cancel on Chrome's bar.
  await worker.evaluate(
    (id) => (globalThis as { __piwiCancelDebugging?: (id: number) => Promise<void> }).__piwiCancelDebugging!(id),
    tabId,
  );
  await expect
    .poll(async () => (await replayState(worker)).driver)
    .toEqual({ driver: 'synthetic', reason: 'canceled' });
  await next();
  await expect.poll(async () => (await replayState(worker)).position).toBe(3);
  await next();
  const state = await finished(worker);
  expect(state.results.map((r) => [r.status, r.driver ?? null])).toEqual([
    ['done', null],
    ['done', 'cdp'],
    ['done', 'synthetic'],
    ['passed', null],
  ]);
  expect(await debuggerAttached(worker, tabId)).toBe(false);
});

test('plays the steps at the viewport they were recorded at, then gives the tab its size back', async ({
  context,
  control,
  site,
  worker,
}) => {
  const doc = {
    ...stepsDoc('Sized', site, [
      step('goto', '/sized', { value: '/sized' }),
      expectText('/sized', 'size', '800×600'),
      expectText('/sized', 'size', '390×664'),
    ]),
    viewports: [
      { step: 0, width: 800, height: 600 },
      { step: 2, width: 390, height: 664 },
    ],
  };
  const page = await startReplay(control, context, site, doc, '/sized');
  const tabId = await tabIdOf(worker, `${site}/sized`);
  const state = await finished(worker);
  expect(state.results.map((r) => r.status)).toEqual(['done', 'passed', 'passed']);
  expect((state as { viewport?: unknown }).viewport).toEqual({ width: 390, height: 664, set: true });
  await expect.poll(() => debuggerAttached(worker, tabId)).toBe(false);
  // Back to the window's size: not the size Playwright emulates, which the cleared override takes away too.
  await expect.poll(() => page.evaluate(() => `${innerWidth}×${innerHeight}`)).not.toMatch(/^(390×664|800×600)$/);
});

test('plays at the recorded size in CSS pixels whatever the zoom of the tab replaying it', async ({
  context,
  control,
  site,
  worker,
}) => {
  // Zoom is kept per site: at 125% here, the replayed tab opens zoomed too.
  const other = await context.newPage();
  await other.goto(`${site}/sized`);
  await worker.evaluate(async (id) => chrome.tabs.setZoom(id, 1.25), await tabIdOf(worker, `${site}/sized`));
  await other.close();
  const doc = {
    ...stepsDoc('Zoomed', site, [step('goto', '/sized', { value: '/sized' }), expectText('/sized', 'size', '390×664')]),
    viewports: [{ step: 0, width: 390, height: 664 }],
  };
  await startReplay(control, context, site, doc, '/sized');
  const state = await finished(worker);
  expect(state.results.map((r) => r.status)).toEqual(['done', 'passed']);
});
