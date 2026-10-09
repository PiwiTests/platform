import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from '@playwright/test';
import { injectCoverage, openShop, stubCoverageChrome } from './coverage-fixtures.js';

/**
 * The extension's illustrations on the docs site, captured from the same shop
 * page and locator index the overlay specs drive. Skipped unless
 * `PIWI_DOCS_SHOTS=1`; recapture with
 * `PIWI_DOCS_SHOTS=1 npm run extension:test:e2e -- docs-screenshots`.
 */

const here = path.dirname(fileURLToPath(import.meta.url));
const SCREENSHOTS = path.join(here, '..', '..', '..', 'docs', 'public', 'screenshots');

test.skip(!process.env.PIWI_DOCS_SHOTS, 'captures docs illustrations only when PIWI_DOCS_SHOTS=1');

test('tested-elements-overlay', async ({ page, context }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await stubCoverageChrome(context);
  await openShop(page, '?nodialog');
  await injectCoverage(page);
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.join(SCREENSHOTS, 'tested-elements-overlay.png') });
});
