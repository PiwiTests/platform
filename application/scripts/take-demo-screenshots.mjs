#!/usr/bin/env node
/**
 * Captures real screenshots of the Piwi Dashboard for the demo attachments.
 *
 * Prerequisites:
 *   1. A regular (non-demo) dev server must be running on port 3002:
 *      NUXT_IGNORE_LOCK=1 npx nuxt dev --port 3002   (from application/)
 *   2. The dev server's SQLite DB must be seeded from the demo seed SQL:
 *      node scripts/seed-dev-from-demo.mjs
 *
 * Usage (from application/):
 *   node scripts/take-demo-screenshots.mjs
 *
 * Output: public/demo/screenshots/*.png  (committed to repo)
 *
 * See AGENTS.md § "Replacing demo screenshots" for the full procedure.
 */

import { createRequire } from 'module';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const pw = require('/home/user/platform/node_modules/playwright/index.js');
const chromium = pw.chromium;

const __dirname = dirname(fileURLToPath(import.meta.url));
const BASE_URL = 'http://localhost:3002';
const OUT_DIR = join(__dirname, '../public/demo/screenshots');

async function goto(page, path, waitFor = 'nav, h1, h2, [class*="UCard"], table, tbody tr') {
  await page.goto(`${BASE_URL}${path}`, { waitUntil: 'networkidle', timeout: 25000 }).catch(() => {});
  if (waitFor) {
    try { await page.waitForSelector(waitFor, { timeout: 10000 }); } catch { }
  }
  await page.waitForTimeout(2000);
}

async function main() {
  const browser = await chromium.launch({
    executablePath: '/opt/pw-browsers/chromium',
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    colorScheme: 'light',
  });

  const page = await context.newPage();

  // 1. Dashboard home
  console.log('Dashboard home...');
  await goto(page, '/');
  await page.screenshot({ path: join(OUT_DIR, 'checkout-form-filled.png') });
  console.log('-> checkout-form-filled.png');

  // 2. Failed test run detail (run #21 has 14 API Integration test cases)
  console.log('Test run detail (run #21)...');
  await goto(page, '/test-runs/21');
  await page.screenshot({ path: join(OUT_DIR, 'checkout-order-confirmed.png') });
  console.log('-> checkout-order-confirmed.png');

  // 3. Project #2 failure clusters tab
  console.log('Project detail with failure clusters tab...');
  await goto(page, '/projects/2?tab=failure-clusters', '.space-y-4, table, [class*="cluster"]');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT_DIR, 'checkout-payment-form.png') });
  console.log('-> checkout-payment-form.png');

  // 4. Cluster #4 detail
  console.log('Cluster detail (cluster #4)...');
  await goto(page, '/failure-clusters/4', '[class*="DiagnosisPanel"], h1, h2, .space-y-4');
  await page.waitForTimeout(4000);
  await page.screenshot({ path: join(OUT_DIR, 'checkout-error.png') });
  console.log('-> checkout-error.png');

  // 5. Projects list
  console.log('Projects list...');
  await goto(page, '/projects');
  await page.screenshot({ path: join(OUT_DIR, 'login-form.png') });
  console.log('-> login-form.png');

  // 6. Project #2 detail (test runs tab)
  console.log('Project detail (test runs tab)...');
  await goto(page, '/projects/2');
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT_DIR, 'cart-summary.png') });
  console.log('-> cart-summary.png');

  await browser.close();
  console.log('All done! Screenshots written to public/demo/screenshots/');
}

main().catch((err) => { console.error(err); process.exit(1); });
