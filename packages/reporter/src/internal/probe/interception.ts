/**
 * Client-probe interception: install a `page.route` handler that applies one
 * plan item's fault to the Nth matching request after the first navigation, then
 * fulfills the request with the mutated response. Thin over the pure helpers in
 * `faults.ts` and `plan.ts`.
 */

import { gunzipSync } from 'node:zlib';
import type { Page } from '@playwright/test';
import { computeFault, type ProbeFault } from './faults.js';
import { createProbeState, markNavigated, requestMatchesRoute, shouldMutate, type ProbePlanItem } from './plan.js';
import { buildProbeHeader, type ServerProbeSpec } from './sign.js';

/** Handle to the interception: whether the fault was actually applied. */
export interface ProbeInterception {
  applied: () => boolean;
}

/**
 * True when a server response's `X-Piwi-Trace` header carries a root span the
 * instrumentation stamped with `piwi.probe.applied` — the only proof the server
 * honored the signed fault. A signed request the server ignored (probes off,
 * wrong secret, route mismatch, or a package that emits no trace) carries no
 * such marker, so the probe records inconclusive rather than a false gap.
 */
export function traceMarksProbeApplied(traceHeader: string | undefined): boolean {
  if (!traceHeader) return false;
  try {
    const spans = JSON.parse(gunzipSync(Buffer.from(traceHeader, 'base64')).toString('utf8'));
    if (!Array.isArray(spans)) return false;
    return spans.some(
      (s) => s && typeof s === 'object' && !s.parentId && s.attrs && s.attrs['piwi.probe.applied'] != null,
    );
  } catch {
    return false;
  }
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
  const probeSecret = process.env.PIWI_PROBE_SECRET;

  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) markNavigated(state);
  });

  await page.route('**/*', async (route) => {
    const request = route.request();
    if (applied || !requestMatchesRoute(request.method(), request.url(), item.routeKey) || !shouldMutate(state, item)) {
      await route.fallback();
      return;
    }

    // A server fault is signed onto the request and applied inside the server;
    // the response is left alone. Without a shared secret it cannot be signed, so
    // the request goes through unmodified and the probe records inconclusive.
    // The fault counts as applied only when the server proves it honored it by
    // stamping the response's trace with `piwi.probe.applied`.
    if (item.level === 'server') {
      if (!probeSecret) {
        await route.fallback();
        return;
      }
      const spec: ServerProbeSpec = { route: item.routeKey, fault: item.fault, nth: item.nth };
      if (item.dependency) spec.dependency = item.dependency;
      try {
        const response = await route.fetch({
          headers: { ...request.headers(), 'x-piwi-probe': buildProbeHeader(probeSecret, spec) },
        });
        applied = traceMarksProbeApplied(response.headers()['x-piwi-trace']);
        await route.fulfill({ response });
      } catch {
        applied = false;
        await route.fallback();
      }
      return;
    }

    try {
      const response = await route.fetch();
      const body = await response.text();
      const out = computeFault(item.fault as ProbeFault, {
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
      applied = false;
      await route.fallback();
    }
  });

  return { applied: () => applied };
}
