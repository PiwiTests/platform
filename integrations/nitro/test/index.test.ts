import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp, eventHandler, toNodeListener } from 'h3';

/**
 * Drive the wrapped h3 handler the way Nitro's node entry does — through
 * `toNodeListener`, which ignores the handler's return value — so a fault that
 * only sets a return value (rather than ending the response) would hang the
 * request. A real HTTP round-trip proves the response actually completes.
 */

const SECRET = 'index-test-probe-secret';

interface LoadedPlugin {
  install: (env: Record<string, string>) => Promise<{ nitroApp: { h3App: ReturnType<typeof createApp> } }>;
}

/** Fresh module load so the env-derived module constants pick up the stubs. */
async function loadWithEnv(env: Record<string, string>) {
  vi.resetModules();
  vi.unstubAllEnvs();
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  const mod = await import('../src/index');
  return mod;
}

function signHeader(
  mod: Awaited<ReturnType<typeof loadWithEnv>>,
  spec: Record<string, unknown>,
  ts: number,
  nonce: string,
): string {
  const specJson = JSON.stringify(spec);
  const sig = mod.signProbeMessage(SECRET, nonce, ts, specJson);
  return Buffer.from(JSON.stringify({ nonce, ts, specJson, sig })).toString('base64');
}

async function withServer(
  app: ReturnType<typeof createApp>,
  fn: (base: string) => Promise<void>,
): Promise<void> {
  const server: Server = createServer(toNodeListener(app));
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const port = (server.address() as AddressInfo).port;
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe('piwiTestLogs wrapped handler (through toNodeListener)', () => {
  it('extreme fault ends the response instead of hanging', async () => {
    const mod = await loadWithEnv({
      PIWI_PROBE_SECRET: SECRET,
      PIWI_SERVER_PROBES: 'true',
      PIWI_TEST_LOGS_DISABLED: 'false',
      NODE_ENV: 'test',
    });
    const app = createApp();
    app.use(
      '/api/orders',
      eventHandler(() => ({ ok: true })),
    );
    mod.default({ h3App: app, hooks: { hook: () => {} } } as never);

    await withServer(app, async (base) => {
      const header = signHeader(mod, { route: 'POST /api/orders', fault: 'extreme' }, Date.now(), 'extreme-nonce');
      const res = await fetch(`${base}/api/orders`, { method: 'POST', headers: { 'x-piwi-probe': header } });
      expect(res.status).toBe(200);
      expect(await res.text()).toBe('');
      // The instrumentation still names the honored fault on the response trace.
      expect(res.headers.get('x-piwi-trace')).toBeTruthy();
    });
  });

  it('passes an unprobed request through to the original handler with trace headers', async () => {
    const mod = await loadWithEnv({
      PIWI_TEST_LOGS_DISABLED: 'false',
      NODE_ENV: 'test',
    });
    const app = createApp();
    app.use(
      '/api/cart',
      eventHandler(() => ({ items: 1 })),
    );
    mod.default({ h3App: app, hooks: { hook: () => {} } } as never);

    await withServer(app, async (base) => {
      const res = await fetch(`${base}/api/cart`);
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ items: 1 });
      expect(res.headers.get('x-piwi-trace')).toBeTruthy();
    });
  });
});
