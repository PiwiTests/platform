/**
 * The wait strategy the dashboard needs when a script drives it with Playwright.
 * The run, execution and notification surfaces hold a Server-Sent Events stream
 * open, so a bare `networkidle` never resolves — these helpers wait for
 * hydration and a bounded settle instead. Both take a Playwright `page`, so the
 * caller owns the browser and this module imports nothing.
 */

/** Wait for the document to load and Nuxt to finish hydrating, with a fallback. */
export async function waitForHydration(page) {
  await page.waitForLoadState('load');
  await page
    .waitForFunction(() => window.useNuxtApp?.().isHydrating === false, undefined, { timeout: 20000 })
    .catch(() => page.waitForTimeout(1500));
}

/**
 * Wait for the page to stop moving: web fonts resolved, no in-flight requests,
 * nothing reporting itself busy, and — when the caller asks — chart geometry
 * actually drawn. Network is given a bounded wait because the SSE stream keeps
 * it from ever going fully idle. Replaces guessing with a timeout.
 */
export async function settlePage(page, { charts = false, timeout = 20_000 } = {}) {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  await page.evaluate(() => document.fonts.ready);
  await page
    .waitForFunction(() => !document.querySelector('[aria-busy="true"]'), undefined, { timeout })
    .catch(() => {});
  if (charts) {
    await page.waitForFunction(
      () => {
        const svgs = [...document.querySelectorAll('svg')];
        return svgs.some((svg) => svg.querySelector('path[d], rect[width], circle[r]'));
      },
      undefined,
      { timeout },
    );
  }
  // One frame after the last mutation, so a chart that just mounted has painted.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}
