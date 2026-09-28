import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test as base, expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import type { RecordedStep, RecordedTarget } from '@piwitests/core/recording';
import type { PiwiSteps } from '@piwitests/core/steps';
import { extensionWorker, launchWithExtension } from './fixtures.js';

/**
 * The real extension on a local site, granted the site's origin as a person
 * grants it, for the specs that need what only the real extension has: the
 * background worker's debugging sessions (trusted input, CDP screenshots,
 * request conditions through the `Fetch` domain). Playwright drives the browser
 * through its own debugging connection; `chrome.debugger` attaches beside it.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');

export interface Fixtures {
  /** The site's origin, `http://127.0.0.1:<port>`; `pages` maps a path to its HTML. */
  site: string;
  pages: Record<string, string>;
  context: BrowserContext;
  worker: Worker;
  /** An extension page, whose messages reach the worker as the popup's do. */
  control: Page;
}

export const test = base.extend<Fixtures>({
  pages: [{}, { option: true }],
  site: async ({ pages }, use) => {
    const server = http.createServer((request, response) => {
      const url = new URL(request.url ?? '/', 'http://x');
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname.includes('fail')) response.statusCode = 500;
        response.setHeader('content-type', 'application/json');
        response.end(JSON.stringify({ total: 40 }));
        return;
      }
      if (url.pathname.includes('missing')) {
        response.statusCode = 404;
        response.end();
        return;
      }
      if (url.pathname.endsWith('.png')) {
        response.setHeader('content-type', 'image/png');
        response.end(
          Buffer.from(
            'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
            'base64',
          ),
        );
        return;
      }
      if (url.pathname.endsWith('.js')) {
        response.setHeader('content-type', 'text/javascript');
        response.end(`document.documentElement.dataset.script = 'loaded';`);
        return;
      }
      response.setHeader('content-type', 'text/html');
      response.end(pages[url.pathname] ?? '<!doctype html><title>Empty</title>');
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    await use(`http://127.0.0.1:${(server.address() as AddressInfo).port}`);
    server.close();
  },
  context: async ({}, use) => {
    const extension = mkdtempSync(path.join(tmpdir(), 'piwi-trusted-ext-'));
    cpSync(DIST, extension, { recursive: true });
    const manifest = JSON.parse(readFileSync(path.join(extension, 'manifest.json'), 'utf8'));
    writeFileSync(
      path.join(extension, 'manifest.json'),
      JSON.stringify({ ...manifest, host_permissions: ['http://127.0.0.1/*'] }),
    );
    const context = await launchWithExtension(extension);
    await use(context);
    await context.close();
  },
  worker: async ({ context }, use) => {
    await use(await extensionWorker(context));
  },
  control: async ({ context, worker }, use) => {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${new URL(worker.url()).host}/options.html`);
    await use(page);
  },
});

export { expect };

export function target(testId: string, role: string | null = null, name: string | null = null): RecordedTarget {
  return {
    tagName: 'div',
    role,
    accessibleName: name,
    testId,
    text: null,
    alternatives: [{ locator: `getByTestId('${testId}')`, method: 'getByTestId', score: 100 }],
  };
}

export function step(action: RecordedStep['action'], pageUrl: string, extra: Partial<RecordedStep> = {}): RecordedStep {
  return { action, target: null, value: null, redacted: false, pageUrl, timestamp: 0, ...extra };
}

export function expectText(pageUrl: string, testId: string, expected: string): RecordedStep {
  return step('assert', pageUrl, {
    target: target(testId),
    assertion: { matcher: 'toHaveText', expected, actual: null, negated: false, note: null },
  });
}

export function stepsDoc(title: string, origin: string, steps: RecordedStep[]): PiwiSteps {
  return { v: 1, title, origin, recordedAt: 0, note: null, steps };
}

export interface StoredReplay {
  id: string;
  status: string;
  position: number;
  results: Array<{ status: string; detail: string | null; driver?: string }>;
  driver?: { driver: string; reason: string | null } | null;
}

/** Starts a replay on `site` as the popup does, then loads `path` in a tab, where the registered script runs it. */
export async function startReplay(
  control: Page,
  context: BrowserContext,
  site: string,
  doc: PiwiSteps,
  path: string,
  stepMode = false,
): Promise<Page> {
  const started = await control.evaluate(
    ({ steps, origin, stepMode }) =>
      chrome.runtime.sendMessage({ type: 'piwi-start-replay', steps, origin, stepMode, inject: false }),
    { steps: doc, origin: site, stepMode },
  );
  expect(started).toEqual({ ok: true });
  const page = await context.newPage();
  await page.goto(`${site}${path}`);
  return page;
}

export async function replayState(worker: Worker): Promise<StoredReplay> {
  return worker.evaluate(async () => (await chrome.storage.session.get('piwiReplay')).piwiReplay as StoredReplay);
}

export async function finished(worker: Worker, timeout = 45_000): Promise<StoredReplay> {
  await expect.poll(async () => (await replayState(worker))?.status, { timeout }).toMatch(/^(done|stopped)$/);
  return replayState(worker);
}

/** Whether the extension holds a debugging session on the tab: a command goes through only then. */
export async function debuggerAttached(worker: Worker, tabId: number): Promise<boolean> {
  return worker.evaluate(async (id) => {
    try {
      await chrome.debugger.sendCommand({ tabId: id }, 'Runtime.evaluate', { expression: '1' });
      return true;
    } catch {
      return false;
    }
  }, tabId);
}

export async function tabIdOf(worker: Worker, url: string): Promise<number> {
  return worker.evaluate(async (u) => (await chrome.tabs.query({ url: `${u}*` }))[0]!.id!, url);
}
