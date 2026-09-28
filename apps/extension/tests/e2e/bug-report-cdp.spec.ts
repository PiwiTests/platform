import { debuggerAttached, expect, tabIdOf, test } from './trusted-site.js';

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
