import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import { test, expect, launchWithExtension, extensionWorker } from './fixtures.js';

/**
 * Chrome keeps running the background worker an unpacked extension started
 * with until the extension is reloaded, while the popup is read from disk each
 * time it opens. So after a rebuild without a reload, the popup runs the new
 * build against the previous build's worker, and messages that only the new
 * build knows go unanswered. This reproduces that on a copy of `dist/`: load
 * it, rewrite its build stamp on disk the way a rebuild would, then check that
 * the popup notices and that its button brings the worker up to date.
 */

const DIST = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'dist');
const REBUILT_STAMP = 'rebuilt-by-worker-build-spec';

let extensionCopy: string;

test.beforeEach(() => {
  extensionCopy = mkdtempSync(path.join(tmpdir(), 'piwi-picker-rebuild-'));
  cpSync(DIST, extensionCopy, { recursive: true });
});

test.afterEach(() => {
  rmSync(extensionCopy, { recursive: true, force: true });
});

/** The build the background worker runs, as it answers the ping. */
async function workerBuild(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const answer = (await chrome.runtime.sendMessage({ type: 'piwi-ping' })) as { build?: string } | undefined;
    return answer?.build ?? '';
  });
}

/** Replaces the build stamp in every bundle of the copy, as a rebuild would; returns the files it changed. */
function rewriteStamp(from: string, to: string): string[] {
  const changed: string[] = [];
  for (const entry of readdirSync(extensionCopy, { recursive: true, withFileTypes: true })) {
    if (!entry.isFile() || !/\.(js|html)$/.test(entry.name)) continue;
    const file = path.join(entry.parentPath, entry.name);
    const text = readFileSync(file, 'utf8');
    if (!text.includes(from)) continue;
    writeFileSync(file, text.replaceAll(from, to));
    changed.push(path.relative(extensionCopy, file));
  }
  return changed;
}

async function openPopup(context: BrowserContext, extensionId: string): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  return page;
}

test('the popup offers a reload when the worker predates a rebuild, and the reload brings it up to date', async () => {
  const context = await launchWithExtension(extensionCopy, { developerMode: true });
  try {
    const extensionId = (await extensionWorker(context)).url().split('/')[2]!;

    // Same build on both sides: no notice. The popup's own check is answered
    // before this ping, both being messages from the same page to the same worker.
    let popup = await openPopup(context, extensionId);
    const loadedBuild = await workerBuild(popup);
    expect(loadedBuild).not.toBe('');
    await expect(popup.locator('#worker-notice')).toBeHidden();
    await popup.close();

    const changed = rewriteStamp(loadedBuild, REBUILT_STAMP);
    // The worker and the popup must both carry the stamp, or this proves nothing.
    expect(changed).toContain('background.js');
    expect(changed.some((file) => file.startsWith(`assets${path.sep}popup-`))).toBe(true);

    // The popup now comes from the rebuilt files, the worker is still the one loaded.
    popup = await openPopup(context, extensionId);
    expect(await workerBuild(popup)).toBe(loadedBuild);
    const notice = popup.locator('#worker-notice');
    await expect(notice).toBeVisible();
    await expect(notice).toContainText('rebuilt since it was loaded');

    // Reloading closes the popup and starts a new worker from the rebuilt files.
    const restarted = context.waitForEvent('serviceworker');
    const closed = popup.waitForEvent('close');
    await notice
      .getByRole('button', { name: 'Reload Piwi Picker' })
      .click()
      .catch((error: unknown) => {
        // The popup can close before Playwright hears back from the click.
        if (!popup.isClosed()) throw error;
      });
    await closed;
    await restarted;

    popup = await openPopup(context, extensionId);
    expect(await workerBuild(popup)).toBe(REBUILT_STAMP);
    await expect(popup.locator('#worker-notice')).toBeHidden();
  } finally {
    await context.close();
  }
});
