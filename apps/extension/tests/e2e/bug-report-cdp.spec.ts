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

test.use({ pages: { '/first': FIRST, '/second': SECOND } });

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
