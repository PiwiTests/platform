import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect } from './fixtures.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');
const ORIGIN = 'https://evidence-test.local';

/**
 * The main-world evidence script on its own, added at document start as its
 * registration adds it: what the page sees of it, and what it relays once the
 * recorder has said its token (`shared/bug-relay.ts`), read here from the
 * window's messages.
 */
async function pageWithEvidenceScript(context: BrowserContext): Promise<Page> {
  await context.addInitScript({ path: path.join(DIST, 'bug-evidence-main.js') });
  await context.route(`${ORIGIN}/**`, async (route) => {
    const { pathname } = new URL(route.request().url());
    if (pathname.startsWith('/down/')) return route.abort();
    if (pathname.startsWith('/bad/')) return route.fulfill({ status: 500, body: 'no' });
    if (pathname.startsWith('/ok/')) return route.fulfill({ status: 200, body: 'yes' });
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body>Evidence</body></html>' });
  });
  const page = await context.newPage();
  await page.goto(`${ORIGIN}/`);
  await page.evaluate(() => {
    const g = globalThis as any;
    g.__relayed = [];
    window.addEventListener('message', (e) => {
      if (e.data?.source === 'piwi-bug-evidence:entry') g.__relayed.push(e.data.item);
    });
    window.postMessage({ source: 'piwi-bug-evidence:hello', token: 't'.repeat(32) }, '*');
  });
  return page;
}

function relayedRequests(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    ((globalThis as any).__relayed as Array<{ kind: string; entry: { method: string; url: string; status: number } }>)
      .filter((item) => item.kind === 'request')
      .map(({ entry }) => `${entry.method} ${entry.url} ${entry.status}`),
  );
}

test.describe('bug-evidence-main.js', () => {
  test('a token sent with a time leaves out what was noted before it', async ({ context }) => {
    await context.addInitScript({ path: path.join(DIST, 'bug-evidence-main.js') });
    await context.route(`${ORIGIN}/**`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><head><script>console.error('as the page loads')</script></head><body></body></html>`,
      }),
    );
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/`);
    const relayed = await page.evaluate(async () => {
      const items: Array<{ entry: { message: string } }> = [];
      window.addEventListener('message', (e) => {
        if (e.data?.source === 'piwi-bug-evidence:entry') items.push(e.data.item);
      });
      await new Promise((resolve) => setTimeout(resolve, 20));
      const since = Date.now();
      console.error('after the time');
      window.postMessage({ source: 'piwi-bug-evidence:hello', token: 't'.repeat(32), since }, '*');
      await new Promise((resolve) => setTimeout(resolve, 100));
      console.error('once relaying');
      await new Promise((resolve) => setTimeout(resolve, 100));
      return items.map((item) => item.entry.message);
    });
    expect(relayed).toEqual(['after the time', 'once relaying']);
  });

  test('a failing fetch the page leaves unhandled is still an unhandled rejection, once', async ({ context }) => {
    const page = await pageWithEvidenceScript(context);
    await page.evaluate(() => {
      const g = globalThis as any;
      g.__rejections = 0;
      window.addEventListener('unhandledrejection', () => g.__rejections++);
      void fetch('/down/unhandled');
      fetch('/down/handled').catch(() => undefined);
    });
    await expect.poll(() => page.evaluate(() => (globalThis as any).__rejections)).toBe(1);
    await page.waitForTimeout(300);
    expect(await page.evaluate(() => (globalThis as any).__rejections)).toBe(1);
    // The page still gets its response, and both failures are relayed.
    expect(await page.evaluate(async () => (await (await fetch('/ok/fine')).text()) as string)).toBe('yes');
    await expect
      .poll(() => relayedRequests(page).then((r) => r.sort()))
      .toEqual(['GET /down/handled 0', 'GET /down/unhandled 0']);
  });

  test('an XHR used again reports each request that failed once, as itself', async ({ context }) => {
    const page = await pageWithEvidenceScript(context);
    await page.evaluate(async () => {
      const xhr = new XMLHttpRequest();
      for (const url of ['/bad/one', '/ok/two', '/bad/three']) {
        await new Promise((resolve) => {
          xhr.open('GET', url);
          xhr.onloadend = resolve;
          xhr.send();
        });
      }
    });
    await page.waitForTimeout(200);
    expect(await relayedRequests(page)).toEqual(['GET /bad/one 500', 'GET /bad/three 500']);
  });
});
