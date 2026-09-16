import { test as base, expect } from '@playwright/test';
import * as http from 'node:http';
import { extendPiwiAi } from '../../../dist/index.js';

/**
 * The LIVE end-to-end test: it drives `page.piwiLocator` / `page.piwiRun` in
 * `resolve` mode against a REAL Piwi dashboard server backed by a REAL LLM
 * so the whole authoring path runs for real — prompt building, the provider
 * call, the deterministic `@piwitests/core` compilation of the model's element
 * picks, execution against a live browser, and the postcondition oracle that
 * verifies the authored flow actually works.
 *
 * Unlike `ai-steps.spec.ts` (which stubs the resolver for a zero-token CI gate),
 * this one costs tokens, so it only runs on demand. The server URL, mode and
 * throwaway artifact directory come from the environment:
 *   PIWI_AI=resolve  PIWI_DASHBOARD_URL=<server>  PIWI_AI_DIR=<temp>
 */
const test = extendPiwiAi(base);

// A tiny app under test: a labelled email field, a submit button that fires one
// Ajax call, and a heading that only appears once the request completes.
const PAGE_HTML = `<!doctype html>
<html>
  <body>
    <div id="app">
      <form id="f">
        <label for="email">Email</label>
        <input id="email" type="email" />
        <button type="submit">Sign in</button>
      </form>
    </div>
    <script>
      document.getElementById('f').addEventListener('submit', async (e) => {
        e.preventDefault();
        const res = await fetch('/api/login', { method: 'POST' });
        await res.json();
        // Replace the whole form with the success state, so the login form (and
        // its Sign in button) is gone — like a real login screen. This keeps the
        // page unambiguous: any sensible postcondition the model picks (the
        // Welcome heading appearing, or the Sign in button disappearing) holds.
        document.getElementById('app').innerHTML = '<h1>Welcome</h1>';
      });
    </script>
  </body>
</html>`;

function startAppServer(): Promise<{ server: http.Server; url: string }> {
  const server = http.createServer((req, res) => {
    if (req.method === 'POST' && req.url === '/api/login') {
      const body = JSON.stringify({ ok: true });
      res.writeHead(200, { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) });
      res.end(body);
      return;
    }
    res.writeHead(200, { 'Content-Type': 'text/html', 'Content-Length': Buffer.byteLength(PAGE_HTML) });
    res.end(PAGE_HTML);
  });
  return new Promise((resolve, reject) => {
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      if (!addr || typeof addr === 'string') return reject(new Error('no addr'));
      resolve({ server, url: `http://127.0.0.1:${addr.port}` });
    });
  });
}

let server: http.Server;
let appUrl: string;

test.beforeAll(async () => {
  if (!process.env.PIWI_DASHBOARD_URL) {
    throw new Error('PIWI_DASHBOARD_URL (the Piwi authoring server) must be set for the live AI E2E');
  }
  ({ server, url: appUrl } = await startAppServer());
});

test.afterAll(async () => {
  if (server) await new Promise<void>((r) => server.close(() => r()));
});

// Live LLM latency: give each resolution room without hiding a real hang.
test.setTimeout(120_000);

test('the model resolves a described element to a working locator', async ({ page }) => {
  await page.goto(appUrl);

  const email = page.piwiLocator('the email address field');
  await email.fill('ada@example.com');
  expect(await email.inputValue()).toBe('ada@example.com');
});

test('the model resolves and runs a multi-step sign-in flow', async ({ page }) => {
  await page.goto(appUrl);

  // The model must drive fill → submit and pick a postcondition; the flow only
  // passes if the authored artifact actually reaches the "Welcome" state.
  await page.piwiRun('sign in as {email}', { email: 'ada@example.com' });

  await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible();
});
