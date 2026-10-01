import { readFile } from 'node:fs/promises';
import { isBugReportArchive } from '@piwitests/core/bug-report';
import { clickInShadow, debuggerAttached, expect, tabIdOf, test } from './trusted-site.js';
import { readStoredZip } from '../zip-reader.js';

/**
 * Report a bug in Chrome, where the evidence comes through the debugging
 * protocol: the console from the page's first script, requests for any kind of
 * resource, and screenshots on any page of the recording, without the popup's
 * `activeTab` grant. Cancelling the debugging bar hands the evidence back to
 * the page's own script.
 */

const FIRST = `<!doctype html><html><body><a href="/second">Next</a></body></html>`;

// The error is logged before any other script of the page runs.
const SECOND = `<!doctype html><html><head><script>console.error('boot failed')</script>
  <script src="/missing.js"></script></head><body>
  <img src="/missing.png" alt="">
  <button id="load" onclick="fetch('/api/fail?id=42')">Load</button>
  <button id="warn" onclick="console.error('after cancel')">Warn</button>
</body></html>`;

// Two blocks of color, a long scroll apart, with nothing drawn over them.
const block = (id: string, color: string) =>
  `<button id="${id}" aria-label="${id}" style="display:block;width:200px;height:120px;margin:40px;border:0;background:${color}"></button>`;
const LONG = `<!doctype html><html><body style="margin:0">${block('top', '#00f')}
  <div style="height:2000px"></div>${block('far', '#f00')}<div style="height:2000px"></div></body></html>`;

test.use({ pages: { '/first': FIRST, '/second': SECOND, '/long': LONG } });

interface Evidence {
  console: Array<{ level: string; source: string; message: string; page: string }>;
  requests: Array<{ method: string; url: string; status: number; page: string }>;
  debugging: { state: string; reason: string | null } | null;
}

test('collects the console, failed requests and screenshots through the debugging protocol, across pages', async ({
  context,
  control,
  site,
  worker,
}) => {
  const page = await context.newPage();
  await page.goto(`${site}/first`);
  const tabId = await tabIdOf(worker, `${site}/first`);
  const started = await control.evaluate(
    ({ tabId, pattern }) =>
      chrome.runtime.sendMessage({ type: 'piwi-start-recording', originPattern: pattern, tabId, mode: 'bug' }),
    { tabId, pattern: `${site}/*` },
  );
  expect(started).toEqual({ ok: true });
  const cdp = () =>
    worker.evaluate(
      async () => (await chrome.storage.session.get('piwiBugCdpEvidence')).piwiBugCdpEvidence as Evidence,
    );
  const relayed = () =>
    worker.evaluate(
      async () => ((await chrome.storage.session.get('piwiBugEvidence')).piwiBugEvidence ?? null) as Evidence | null,
    );

  await expect.poll(async () => (await cdp())?.debugging).toEqual({ state: 'on', reason: null });
  expect(await debuggerAttached(worker, tabId)).toBe(true);

  await page.getByRole('link', { name: 'Next' }).click();
  await page.waitForURL('**/second');
  await page.locator('#load').click();
  await expect
    .poll(async () => (await cdp()).requests.map((r) => `${r.method} ${r.url} ${r.status}`).sort())
    .toEqual(['GET /api/fail?id=%3Credacted%3E 500', 'GET /missing.js 404', 'GET /missing.png 404']);
  expect((await cdp()).console).toContainEqual(
    expect.objectContaining({ level: 'error', source: 'console', message: 'boot failed', page: '/second' }),
  );
  // The tab's own relay stays quiet, so nothing is counted twice.
  expect((await relayed())?.console ?? []).toEqual([]);

  // A screenshot after a navigation, with no popup opened on the tab.
  await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-record-hud-host'))).toBe(true);
  await worker.evaluate((id) => chrome.tabs.sendMessage(id, { type: 'piwi-bug-take-screenshot' }), tabId);
  await expect
    .poll(() =>
      worker.evaluate(async () => {
        const shots = ((await chrome.storage.session.get('piwiBugScreenshots')).piwiBugScreenshots ?? []) as Array<{
          dataUrl: string;
          moment: string;
        }>;
        return shots.map((s) => `${s.moment} ${s.dataUrl.slice(0, 22)}`);
      }),
    )
    .toEqual(['manual data:image/png;base64,']);

  // The person cancels the debugging bar: the page's own script relays from then on.
  await worker.evaluate(
    (id) => (globalThis as { __piwiCancelDebugging?: (id: number) => Promise<void> }).__piwiCancelDebugging!(id),
    tabId,
  );
  await expect.poll(async () => (await cdp()).debugging).toEqual({ state: 'off', reason: 'canceled' });
  await page.locator('#warn').click();
  await expect.poll(async () => ((await relayed())?.console ?? []).map((c) => c.message)).toContain('after cancel');

  await control.evaluate(() => chrome.runtime.sendMessage({ type: 'piwi-recording-stopped' }));
  expect(await debuggerAttached(worker, tabId)).toBe(false);
});

test('keeps a screenshot of the page as each step began, with its element, in the .piwibug', async ({
  context,
  control,
  site,
  worker,
}) => {
  const page = await context.newPage();
  await page.goto(`${site}/first`);
  const tabId = await tabIdOf(worker, `${site}/first`);
  const started = await control.evaluate(
    ({ tabId, pattern }) =>
      chrome.runtime.sendMessage({ type: 'piwi-start-recording', originPattern: pattern, tabId, mode: 'bug' }),
    { tabId, pattern: `${site}/*` },
  );
  expect(started).toEqual({ ok: true });
  // How many views the worker keeps: each page's first is taken as the recorder starts there.
  const kept = () =>
    worker.evaluate(
      () =>
        new Promise<number>((resolve) => {
          const open = indexedDB.open('piwi-step-views');
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('recording')) return resolve(0);
            const count = db.transaction('recording').objectStore('recording').count();
            count.onsuccess = () => resolve(count.result);
          };
          open.onerror = () => resolve(0);
        }),
    );
  await expect.poll(kept).toBe(1);
  const link = (await page.getByRole('link', { name: 'Next' }).boundingBox())!;
  await page.getByRole('link', { name: 'Next' }).click();
  await page.waitForURL('**/second');
  await expect.poll(kept).toBe(2);
  await page.locator('#load').click();

  type Click = { kind: string; view?: { id: string; box: { x: number; y: number; width: number; height: number } } };
  const clicks = async () =>
    (
      (await worker.evaluate(
        async () => ((await chrome.storage.session.get('piwiRecording')).piwiRecording as { events: unknown[] }).events,
      )) as Click[]
    ).filter((e) => e.kind === 'click');
  await expect.poll(async () => (await clicks()).length).toBe(2);
  const [first, second] = await clicks();
  expect(first!.view!.box).toEqual({
    x: Math.round(link.x),
    y: Math.round(link.y),
    width: Math.round(link.width),
    height: Math.round(link.height),
  });
  expect(first!.view!.id).not.toBe(second!.view!.id);
  type View = { id: string; dataUrl: string; viewport: { width: number; height: number } | null };
  const views = () =>
    control.evaluate(
      (ids) => chrome.runtime.sendMessage({ type: 'piwi-bug-step-views', ids }) as Promise<View[]>,
      [first!.view!.id, second!.view!.id],
    );
  await expect.poll(async () => (await views()).length).toBe(2);
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  for (const view of await views()) {
    expect(view.dataUrl.startsWith('data:image/jpeg;base64,')).toBe(true);
    expect(view.viewport).toEqual(size);
    // As wide as the viewport in CSS pixels, whatever the screen's pixel ratio.
    const width = await control.evaluate(
      async (url) => (await createImageBitmap(await (await fetch(url)).blob())).width,
      view.dataUrl,
    );
    expect(width).toBe(Math.min(size.width, 1280));
  }

  await clickInShadow(page, 'Finish');
  await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-record-review-host'))).toBe(true);
  const download = page.waitForEvent('download');
  await clickInShadow(page, 'Download .piwibug');
  const archive = new Uint8Array(await readFile((await (await download).path())!));
  expect(isBugReportArchive(archive)).toBe(true);
  const files = readStoredZip(archive);
  expect([...files.keys()].filter((name) => name.startsWith('steps/'))).toEqual(['steps/002.jpg', 'steps/003.jpg']);
  const evidence = JSON.parse(new TextDecoder().decode(files.get('evidence.json')));
  expect(evidence.evidence.stepShots.map((s: { step: number; file: string }) => [s.step, s.file])).toEqual([
    [1, 'steps/002.jpg'],
    [2, 'steps/003.jpg'],
  ]);
  expect(evidence.evidence.stepShots[0].box).toEqual(first!.view!.box);
});

test('keeps the zoom of the tab with the viewport size, which already holds it', async ({
  context,
  control,
  site,
  worker,
}) => {
  const page = await context.newPage();
  await page.goto(`${site}/first`);
  const tabId = await tabIdOf(worker, `${site}/first`);
  await worker.evaluate(async (id) => chrome.tabs.setZoom(id, 1.25), tabId);
  await expect.poll(() => page.evaluate(() => devicePixelRatio)).toBe(1.25);
  const started = await control.evaluate(
    ({ tabId, pattern }) =>
      chrome.runtime.sendMessage({ type: 'piwi-start-recording', originPattern: pattern, tabId, mode: 'bug' }),
    { tabId, pattern: `${site}/*` },
  );
  expect(started).toEqual({ ok: true });
  const size = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  const viewports = () =>
    worker.evaluate(async () =>
      (
        (await chrome.storage.session.get('piwiRecording')).piwiRecording as {
          events: Array<{ kind: string; viewport?: unknown }>;
        }
      ).events
        .filter((e) => e.kind === 'viewport')
        .map((e) => e.viewport),
    );
  await expect.poll(viewports).toEqual([{ ...size, zoom: 1.25 }]);
  await control.evaluate(() => chrome.runtime.sendMessage({ type: 'piwi-recording-stopped' }));
});

test('takes the view again when the page scrolls, so each box sits on its element in the screenshot', async ({
  context,
  control,
  site,
  worker,
}) => {
  const page = await context.newPage();
  await page.goto(`${site}/long`);
  const tabId = await tabIdOf(worker, `${site}/long`);
  const started = await control.evaluate(
    ({ tabId, pattern }) =>
      chrome.runtime.sendMessage({ type: 'piwi-start-recording', originPattern: pattern, tabId, mode: 'bug' }),
    { tabId, pattern: `${site}/*` },
  );
  expect(started).toEqual({ ok: true });
  const keptIds = () =>
    worker.evaluate(
      () =>
        new Promise<string[]>((resolve) => {
          const open = indexedDB.open('piwi-step-views');
          open.onsuccess = () => {
            const db = open.result;
            if (!db.objectStoreNames.contains('recording')) return resolve([]);
            const keys = db.transaction('recording').objectStore('recording').getAllKeys();
            keys.onsuccess = () => resolve(keys.result as string[]);
          };
          open.onerror = () => resolve([]);
        }),
    );
  await expect.poll(async () => (await keptIds()).length).toBe(1);
  const [first] = await keptIds();

  type Box = { x: number; y: number; width: number; height: number };
  const clickViews = async () =>
    (
      (await worker.evaluate(
        async () => ((await chrome.storage.session.get('piwiRecording')).piwiRecording as { events: unknown[] }).events,
      )) as Array<{ kind: string; view?: { id: string; box: Box } }>
    )
      .filter((e) => e.kind === 'click')
      .map((e) => e.view!);
  // The color of the screenshot kept for a view, where the view's box says its element is.
  const colorAt = async (view: { id: string; box: Box }) => {
    const [kept] = (await control.evaluate(
      (id) => chrome.runtime.sendMessage({ type: 'piwi-bug-step-views', ids: [id] }),
      view.id,
    )) as Array<{ dataUrl: string; viewport: { width: number } }>;
    if (!kept) return 'none';
    return control.evaluate(
      async ({ dataUrl, width, box }) => {
        const bitmap = await createImageBitmap(await (await fetch(dataUrl)).blob());
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext('2d')!;
        context.drawImage(bitmap, 0, 0);
        const scale = bitmap.width / width;
        const at = (n: number, size: number) => Math.round((n + size / 2) * scale);
        const [r, g, b] = context.getImageData(at(box.x, box.width), at(box.y, box.height), 1, 1).data;
        if (r! > 180 && g! < 90 && b! < 90) return 'red';
        if (b! > 180 && r! < 90 && g! < 90) return 'blue';
        return `rgb(${r}, ${g}, ${b})`;
      },
      { dataUrl: kept.dataUrl, width: kept.viewport.width, box: view.box },
    );
  };

  // Scrolled down and clicked at once: the view taken at the top is taken again, under its id.
  await page.evaluate(() => window.scrollTo(0, document.getElementById('far')!.offsetTop - 100));
  await page.locator('#far').click();
  await expect.poll(async () => (await clickViews()).length).toBe(1);
  const [far] = await clickViews();
  expect(far!.id).toBe(first);
  await expect.poll(() => colorAt(far!)).toBe('red');

  // Scrolled back up, and the page left to settle before the click.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(1500);
  await page.locator('#top').click();
  await expect.poll(async () => (await clickViews()).length).toBe(2);
  const [, top] = await clickViews();
  await expect.poll(() => colorAt(top!)).toBe('blue');
  await control.evaluate(() => chrome.runtime.sendMessage({ type: 'piwi-recording-stopped' }));
});
