/**
 * Client-probe interception: install a `page.route` handler that applies one
 * plan item's fault to the Nth matching request after the first navigation, then
 * fulfills the request with the mutated response. Thin over the pure helpers in
 * `faults.ts` and `plan.ts`.
 */

import type { Page } from '@playwright/test';
import { computeFault } from './faults.js';
import { createProbeState, markNavigated, requestMatchesRoute, shouldMutate, type ProbePlanItem } from './plan.js';

/** Handle to the interception: whether the fault was actually applied. */
export interface ProbeInterception {
  applied: () => boolean;
}

/**
 * Install the fault interception for one plan item on a page. Requests before the
 * first navigation (seeding) are never touched; the fault is applied to the Nth
 * matching request exactly once, by fetching the real response and fulfilling
 * with the mutation.
 */
export async function installProbeInterception(page: Page, item: ProbePlanItem): Promise<ProbeInterception> {
  const state = createProbeState();
  let applied = false;

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) markNavigated(state);
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (applied || !requestMatchesRoute(request.method(), request.url(), item.routeKey) || !shouldMutate(state, item)) {
      await route.fallback();
      return;
    }
    try {
      const response = await route.fetch();
      const body = await response.text();
      const out = computeFault(item.fault, {
        status: response.status(),
        body,
        contentType: response.headers()['content-type'] ?? null,
      });
      if (out.delayMs > 0) await new Promise((resolve) => setTimeout(resolve, out.delayMs));
      applied = true;
      await route.fulfill({
        status: out.status,
        body: out.body,
        ...(out.contentType ? { contentType: out.contentType } : {}),
      });
    } catch {
      // A fetch or fulfill failure must not wedge the test — let the real
      // request through, recorded as not applied.
      await route.fallback();
    }
  });

  return { applied: () => applied };
}
