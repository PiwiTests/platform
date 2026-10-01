import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import type { PiwiSteps } from '@piwitests/core/steps';
import { test, expect } from './fixtures.js';
import { readCatalog, stubChromeI18n } from './i18n-stub.js';
import { clippedInShadows, openShadowRoots } from './shadow.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const DIST = path.join(here, '..', '..', 'dist');
const ORIGIN = 'https://replay-test.local';

/**
 * The replay script, driven the way `record.spec.ts` drives the recorder: the
 * built bundle runs in the page with a stubbed `chrome.storage` kept in
 * `window.name`, which survives the replay's own navigations in the tab. The
 * bundle is added as an init script, as the background script's registration
 * adds it to every page of the origin.
 */
async function stubChrome(context: BrowserContext, session: Record<string, unknown>, language = 'en'): Promise<void> {
  await context.addInitScript((seed) => {
    function load(): { session: Record<string, unknown> } {
      if (!window.name) return { session: seed };
      try {
        return { session: JSON.parse(window.name).session ?? {} };
      } catch {
        return { session: {} };
      }
    }
    function persist(data: { session: Record<string, unknown> }): void {
      window.name = JSON.stringify(data);
    }
    if (!window.name) persist(load());
    const area = {
      get: async (key: string) => ({ [key]: load().session[key] }),
      set: async (values: Record<string, unknown>) => {
        const data = load();
        Object.assign(data.session, values);
        persist(data);
      },
      remove: async (key: string) => {
        const data = load();
        delete data.session[key];
        persist(data);
      },
    };
    (globalThis as any).chrome = {
      storage: { session: area, local: area },
      runtime: {
        sendMessage: async () => ({ ok: true }),
        onMessage: {
          addListener: (fn: (message: unknown) => void) => {
            ((globalThis as any).__piwiTestRuntimeListeners ??= []).push(fn);
          },
        },
      },
    };
  }, session);
  await stubChromeI18n(context, language);
  await context.addInitScript({ path: path.join(DIST, 'replay-panel.js') });
}

const LOGIN = `<!doctype html><html><body>
  <input id="username" data-testid="username-field" aria-label="Username" />
  <button data-testid="login-submit" onclick="location.href='/dashboard'">Log in</button>
</body></html>`;

/** The cart: `fixed` adds the coupon, the buggy one does not, and `broken` has no button at all. */
function dashboard(kind: 'buggy' | 'fixed' | 'broken'): string {
  const onclick = kind === 'fixed' ? `document.getElementById('total').textContent = 'Total: 42'` : '';
  const button =
    kind === 'broken' ? '' : `<button data-testid="add-to-cart" onclick="${onclick}">Apply coupon</button>`;
  return `<!doctype html><html><body>${button}<output id="total" data-testid="cart-total">Total: 40</output></body></html>`;
}

async function routePages(context: BrowserContext, kind: 'buggy' | 'fixed' | 'broken'): Promise<void> {
  await context.route(`${ORIGIN}/**`, async (route) => {
    const url = new URL(route.request().url());
    await route.fulfill({ contentType: 'text/html', body: url.pathname === '/dashboard' ? dashboard(kind) : LOGIN });
  });
}

const target = (testId: string, role: string | null, name: string | null) => ({
  tagName: role === 'button' ? 'button' : 'input',
  role,
  accessibleName: name,
  testId,
  text: null,
  alternatives: [{ locator: `getByTestId('${testId}')`, method: 'getByTestId', score: 100 }],
});

/** A bug report recorded on staging, replayed on the test origin. */
const REPORT: PiwiSteps = {
  v: 1,
  title: 'Coupon not applied',
  origin: 'https://staging.acme.test',
  recordedAt: 0,
  note: null,
  steps: [
    { action: 'goto', target: null, value: '/login', redacted: false, pageUrl: '/login', timestamp: 0 },
    {
      action: 'fill',
      target: target('username-field', 'textbox', 'Username'),
      value: 'alice',
      redacted: false,
      pageUrl: '/login',
      timestamp: 1,
    },
    {
      action: 'click',
      target: target('login-submit', 'button', 'Log in'),
      value: null,
      redacted: false,
      pageUrl: '/login',
      timestamp: 2,
    },
    {
      action: 'click',
      target: target('add-to-cart', 'button', 'Apply coupon'),
      value: null,
      redacted: false,
      pageUrl: '/dashboard',
      timestamp: 3,
    },
    {
      action: 'assert',
      target: target('cart-total', 'status', null),
      value: null,
      redacted: false,
      pageUrl: '/dashboard',
      timestamp: 4,
      assertion: { matcher: 'toHaveText', expected: 'Total: 42', actual: 'Total: 40', negated: false, note: null },
    },
  ],
};

function running(
  stepMode = false,
  startPage: { recorded: string; actual: string } | null = null,
): Record<string, unknown> {
  return {
    piwiReplay: {
      id: 'r1',
      steps: REPORT,
      origin: ORIGIN,
      position: 0,
      results: [],
      status: 'running',
      stepMode,
      cursor: null,
      startedAt: 0,
      startPage,
    },
  };
}

/** The replay's stored state, read from the page; the replay navigates it, so a read can land mid-load and is retried. */
async function replayState(
  page: Page,
): Promise<{ status: string; results: Array<{ status: string; detail: string | null }> }> {
  for (;;) {
    try {
      return await page.evaluate(() => JSON.parse(window.name).session.piwiReplay);
    } catch (error) {
      if (!/Execution context was destroyed|navigat/i.test(String(error))) throw error;
      await page.waitForLoadState('domcontentloaded');
    }
  }
}

async function verdict(page: Page): Promise<Record<string, unknown>> {
  await expect.poll(() => replayState(page).then((s) => s.status), { timeout: 30_000 }).toBe('done');
  return page.evaluate(
    () => (globalThis as { __piwiReplayVerdict?: Record<string, unknown> }).__piwiReplayVerdict ?? {},
  );
}

test.describe('replay-panel.js', () => {
  test('replays a report across pages with a fake cursor, and finds the bug as reported', async ({ context }) => {
    await routePages(context, 'buggy');
    await stubChrome(context, running());
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/login`);

    await page.waitForURL('**/dashboard');
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-replay-cursor-host'))).toBe(true);
    await expect.poll(() => page.evaluate(() => !!document.getElementById('piwi-replay-hud-host'))).toBe(true);

    expect(await verdict(page)).toEqual({ kind: 'reproduced', step: 4, found: '"Total: 40"', sameAsReported: true });
    expect((await replayState(page)).results.map((r) => r.status)).toEqual(['done', 'done', 'done', 'done', 'failed']);
  });

  test('says the bug does not show when the expected result holds', async ({ context }) => {
    await routePages(context, 'fixed');
    await stubChrome(context, running());
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${ORIGIN}/login`);
    expect(await verdict(page)).toEqual({ kind: 'not-reproduced' });
  });

  test('starts from the tab’s own page when asked, whatever its address', async ({ context }) => {
    await routePages(context, 'buggy');
    const opened: string[] = [];
    context.on('request', (request) => {
      if (request.resourceType() === 'document') opened.push(new URL(request.url()).pathname);
    });
    await stubChrome(context, running(false, { recorded: `${ORIGIN}/login`, actual: `${ORIGIN}/signin?from=mail` }));
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${ORIGIN}/signin?from=mail`);
    expect(await verdict(page)).toEqual({ kind: 'reproduced', step: 4, found: '"Total: 40"', sameAsReported: true });
    expect(opened).toEqual(['/signin', '/dashboard']);
    expect((await replayState(page)).results[0]).toEqual({
      status: 'done',
      detail: 'Started from the tab’s page instead.',
    });
  });

  test('step by step turned off while the page is still settling plays the rest', async ({ context }) => {
    await routePages(context, 'buggy');
    // The page keeps changing for a while, so the first step waits for it: the
    // panel is up, and step mode is turned off, before the replay reaches Next.
    await context.addInitScript(() => {
      const started = Date.now();
      const tick = setInterval(() => {
        document.body?.setAttribute('data-tick', String(Date.now()));
        if (Date.now() - started > 2500) clearInterval(tick);
      }, 100);
    });
    await stubChrome(context, running(true));
    await openShadowRoots(context);
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${ORIGIN}/login`);
    const stepByStep = page.locator('#piwi-replay-hud-host').getByRole('checkbox', { name: 'Step by step' });
    await stepByStep.uncheck();
    expect(await verdict(page)).toEqual({ kind: 'reproduced', step: 4, found: '"Total: 40"', sameAsReported: true });
  });

  test('a Next from the Piwi panel in DevTools plays the step waiting for it', async ({ context }) => {
    await routePages(context, 'buggy');
    await stubChrome(context, running(true));
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${ORIGIN}/login`);
    await expect(page.locator('#piwi-replay-hud-host')).toBeAttached();
    await expect.poll(async () => (await replayState(page)).results.length).toBe(1);
    // What the panel sends to the replayed site's tabs after a Next.
    await page.evaluate(() => {
      for (const fn of (globalThis as any).__piwiTestRuntimeListeners ?? [])
        fn({ type: 'piwi-replay-wake', wake: true });
    });
    await expect.poll(async () => (await replayState(page)).results.length).toBe(2);
  });

  test('says which request conditions were on', async ({ context }) => {
    await routePages(context, 'buggy');
    const session = running();
    const conditions = [{ id: 'c1', method: 'GET', pattern: '**/api/cart', kind: 'delay', delayMs: 2000 }];
    await stubChrome(context, { piwiReplay: { ...(session.piwiReplay as object), conditions } });
    await openShadowRoots(context);
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${ORIGIN}/login`);
    await verdict(page);
    await expect(page.locator('#piwi-replay-hud-host')).toContainText(
      'Request conditions on: Slow down GET **/api/cart by 2 s',
    );
  });

  test('stops where the page differs, and says why', async ({ context }) => {
    await routePages(context, 'broken');
    await stubChrome(context, running());
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${ORIGIN}/login`);
    expect(await verdict(page)).toEqual({
      kind: 'diverged',
      step: 3,
      reason: "Nothing on this page matches getByTestId('add-to-cart').",
    });
  });
});

/** The worker's answers, by message type; every message the page sends is kept in `__piwiSent`. */
async function stubWorker(context: BrowserContext, answers: Record<string, unknown>): Promise<void> {
  await context.addInitScript((byType) => {
    const sent: Array<{ type?: string }> = [];
    (globalThis as any).__piwiSent = sent;
    (globalThis as any).chrome.runtime.sendMessage = async (message: { type?: string }) => {
      sent.push(message);
      return (byType as Record<string, unknown>)[message.type ?? ''] ?? { ok: true };
    };
  }, answers);
}

test.describe('Run with Playwright', () => {
  async function chooseReport(page: Page) {
    const dialog = page.locator('#piwi-replay-dialog-host').getByRole('dialog', { name: 'Replay a bug report' });
    await dialog.getByLabel(/steps\.json/).setInputFiles({
      name: 'steps.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(REPORT)),
    });
    await expect(dialog).toContainText('Coupon not applied');
    await dialog.getByRole('button', { name: 'Run with Playwright…' }).click();
    return page
      .locator('#piwi-desktop-run-host')
      .getByRole('dialog', { name: 'Run with Playwright in the desktop app' });
  }

  test('shows what it sends, sends nothing before Send, then shows the desktop app’s verdict', async ({ context }) => {
    await openShadowRoots(context);
    await routePages(context, 'buggy');
    await stubChrome(context, {});
    await stubWorker(context, {
      'piwi-desktop-target': { paired: true, url: 'http://127.0.0.1:4318' },
      'piwi-desktop-repro': { ok: true, id: 'a1b2', windowOpen: true },
      'piwi-desktop-repro-status': {
        ok: true,
        status: 'done',
        verdict: { kind: 'reproduced', step: 4, found: '"Total: 40"' },
      },
    });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/login`);

    const desktop = await chooseReport(page);
    await expect(desktop).toContainText('Sends to the desktop app at http://127.0.0.1:4318');
    await expect(desktop).toContainText('5. ');
    const sentTypes = () => page.evaluate(() => ((globalThis as any).__piwiSent as any[]).map((m) => m.type));
    expect(await sentTypes()).not.toContain('piwi-desktop-repro');

    await desktop.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(desktop).toContainText('Reproduced: the bug shows here');
    const sent = await page.evaluate(() =>
      ((globalThis as any).__piwiSent as any[]).find((m) => m.type === 'piwi-desktop-repro'),
    );
    expect(sent.steps.title).toBe('Coupon not applied');
    expect(sent.steps.steps).toHaveLength(5);
    expect(sent.bugReportId).toBeNull();
  });

  test('says to pair the desktop app first when none is', async ({ context }) => {
    await openShadowRoots(context);
    await routePages(context, 'buggy');
    await stubChrome(context, {});
    await stubWorker(context, { 'piwi-desktop-target': { paired: false, url: null } });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/login`);

    const desktop = await chooseReport(page);
    await expect(desktop).toContainText('Pair the desktop app first');
    await expect(desktop.getByRole('button', { name: 'Open the options' })).toBeVisible();
  });
});

test.describe('after a replay', () => {
  /** The cart, whose Apply posts a coupon the server refuses and logs the error. */
  async function routeFailingCart(context: BrowserContext): Promise<void> {
    await routePages(context, 'buggy');
    await context.route(`${ORIGIN}/dashboard`, (route) =>
      route.fulfill({
        contentType: 'text/html',
        body: `<!doctype html><html><body>
          <button data-testid="add-to-cart" onclick="fetch('/api/cart/coupon', { method: 'POST' }).then(() => console.error('Coupon failed: 500'))">Apply coupon</button>
          <output id="total" data-testid="cart-total">Total: 40</output></body></html>`,
      }),
    );
    await context.route(`${ORIGIN}/api/**`, (route) => route.fulfill({ status: 500, body: '{}' }));
  }

  test('says what the page showed during the replay: the failed request and the console error', async ({ context }) => {
    await openShadowRoots(context);
    await routeFailingCart(context);
    const state = running() as { piwiReplay: Record<string, unknown> };
    await stubChrome(context, { piwiReplay: { ...state.piwiReplay, evidenceToken: 'tok1' } });
    // The background script registers it in the page's main world for as long as the replay runs.
    await context.addInitScript({ path: path.join(DIST, 'bug-evidence-main.js') });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/login`);

    expect(await verdict(page)).toMatchObject({ kind: 'reproduced' });
    const hud = page.locator('#piwi-replay-hud-host');
    await expect(hud).toContainText('What the page showed during the replay:');
    await expect(hud).toContainText('POST /api/cart/coupon answered 500');
    await expect(hud).toContainText('Console error: Coupon failed: 500');
  });

  test('shares the verdict on the report it came from, after showing what it sends', async ({ context }) => {
    await openShadowRoots(context);
    await routePages(context, 'buggy');
    const state = running() as { piwiReplay: Record<string, unknown> };
    await stubChrome(context, { piwiReplay: { ...state.piwiReplay, bugReportId: 37 } });
    await stubWorker(context, {
      'piwi-share-target': { instance: 'piwi.acme.test' },
      'piwi-share-reproduction': { ok: true },
    });
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/login`);

    expect(await verdict(page)).toMatchObject({ kind: 'reproduced' });
    const hud = page.locator('#piwi-replay-hud-host');
    await hud.getByRole('button', { name: 'Share result…' }).click();
    await expect(hud).toContainText(
      `Sends to piwi.acme.test, on the report: this verdict, the site it ran on (${ORIGIN})`,
    );
    const shares = () =>
      page.evaluate(() =>
        ((globalThis as any).__piwiSent as any[]).filter((m) => m.type === 'piwi-share-reproduction'),
      );
    expect(await shares()).toEqual([]);
    await hud.getByRole('button', { name: 'Send', exact: true }).click();
    await expect(hud).toContainText('Shared on the report.');
    expect(await shares()).toEqual([
      {
        type: 'piwi-share-reproduction',
        bugReportId: 37,
        source: 'replay',
        verdict: 'reproduced',
        divergedAt: null,
        origin: ORIGIN,
      },
    ]);
  });

  test('offers no Share result for steps that did not come from the instance', async ({ context }) => {
    await openShadowRoots(context);
    await routePages(context, 'buggy');
    await stubChrome(context, running());
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/login`);
    expect(await verdict(page)).toMatchObject({ kind: 'reproduced' });
    await expect(page.locator('#piwi-replay-hud-host').getByRole('button', { name: 'Replay again' })).toBeVisible();
    await expect(page.locator('#piwi-replay-hud-host').getByRole('button', { name: 'Share result…' })).toHaveCount(0);
  });
});

test.describe('replay-panel.js in French', () => {
  test('shows its panel and its verdict in French, the page texts quoted the French way', async ({ context }) => {
    await openShadowRoots(context);
    await routePages(context, 'buggy');
    await stubChrome(context, running(true), 'fr');
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${ORIGIN}/login`);

    const hud = page.locator('#piwi-replay-hud-host').getByRole('region');
    await expect(hud).toHaveAttribute('lang', 'fr');
    await expect(hud).toHaveAttribute('aria-label', 'Piwi Picker\u00a0: rapport de bug rejoué');
    await expect(hud).toContainText('En cours : Coupon not applied');
    await expect(hud).toContainText('étape 2 sur 5');
    await expect(hud.getByRole('button', { name: 'Étape suivante' })).toBeVisible();
    await expect(hud.getByRole('checkbox', { name: 'Pas à pas' })).toBeChecked();

    // Plays the rest without stopping.
    await hud.getByRole('checkbox', { name: 'Pas à pas' }).uncheck();
    expect(await verdict(page)).toEqual({
      kind: 'reproduced',
      step: 4,
      found: '«\u202fTotal: 40\u202f»',
      sameAsReported: true,
    });
    const done = page.locator('#piwi-replay-hud-host').getByRole('region');
    await expect(done).toHaveAttribute('lang', 'fr');
    const status = done.getByRole('status');
    await expect(status).toContainText('Reproduit\u00a0: le bug est visible ici');
    await expect(status).toContainText(
      'Étape 5\u00a0: attendu «\u202fTotal: 42\u202f», résultat\u00a0: «\u202fTotal: 40\u202f», comme signalé.',
    );
    await expect(done).toContainText('Terminé : Coupon not applied');
    await expect(done).toContainText('Résultat : «\u202fTotal: 40\u202f».');
    // The steps in French words, the page's texts as they are.
    await expect(done).toContainText('2. Saisir «\u202falice\u202f» dans le champ de texte «\u202fUsername\u202f»');
    await expect(done).toContainText('4. Cliquer sur le bouton «\u202fApply coupon\u202f»');
    await expect(done).toContainText(
      '5. L’élément avec le test id cart-total devrait afficher «\u202fTotal: 42\u202f»',
    );
    await expect(done.getByRole('button', { name: 'Rejouer' })).toBeVisible();
    await expect(done.getByRole('button', { name: 'Fermer' })).toBeVisible();
    expect(await clippedInShadows(page)).toEqual([]);
  });

  test('says in French why the replay stopped where the page differs', async ({ context }) => {
    await openShadowRoots(context);
    await routePages(context, 'broken');
    await stubChrome(context, running(), 'fr');
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${ORIGIN}/login`);
    expect(await verdict(page)).toEqual({
      kind: 'diverged',
      step: 3,
      reason: "Aucun élément de cette page ne correspond à getByTestId('add-to-cart').",
    });
    const status = page.locator('#piwi-replay-hud-host').getByRole('status');
    await expect(status).toContainText('Impossible d’atteindre le bug\u00a0: arrêt à l’étape 4');
    await expect(status).toContainText('Cette page n’est pas la même que dans le rapport');
    expect(await clippedInShadows(page)).toEqual([]);
  });

  test('asks for the report to replay in French, and says what is wrong with a file', async ({ context }) => {
    await openShadowRoots(context);
    await routePages(context, 'buggy');
    await stubChrome(context, {}, 'fr');
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/login`);

    const dialog = page.locator('#piwi-replay-dialog-host').getByRole('dialog', { name: 'Rejouer un rapport de bug' });
    await expect(dialog).toHaveAttribute('lang', 'fr');
    await expect(dialog).toContainText(`Rejoue ses étapes sur ${ORIGIN}`);
    await dialog.getByRole('button', { name: 'Rejouer' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Choisissez d’abord un rapport.');

    const file = dialog.getByLabel('Le .piwibug du rapport de bug, ou son steps.json');
    await file.setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
    await expect(dialog.getByRole('alert')).toContainText('notes.json n’est pas un fichier d’étapes\u00a0:');

    await file.setInputFiles({
      name: 'steps.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(REPORT)),
    });
    await expect(dialog).toContainText(`Coupon not applied · 5 étapes · enregistré sur ${REPORT.origin}`);
    await expect(
      dialog.getByRole('checkbox', { name: 'Pas à pas : cliquez sur Étape suivante avant chaque étape' }),
    ).toBeVisible();
    expect(await clippedInShadows(page)).toEqual([]);
  });
});

test.describe('replay-panel.js in German', () => {
  const catalog = readCatalog('de');

  test('lays out its panel and its verdict without clipping', async ({ context }) => {
    await openShadowRoots(context);
    await routePages(context, 'buggy');
    await stubChrome(context, running(true), 'de');
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${ORIGIN}/login`);

    const hud = page.locator('#piwi-replay-hud-host').getByRole('region');
    await expect(hud).toHaveAttribute('lang', 'de');
    await expect(hud.getByRole('checkbox')).toBeChecked();
    expect(await clippedInShadows(page)).toEqual([]);

    await hud.getByRole('checkbox').uncheck();
    expect(await verdict(page)).toMatchObject({ kind: 'reproduced' });
    const done = page.locator('#piwi-replay-hud-host').getByRole('region');
    await expect(done).toHaveAttribute('lang', 'de');
    await expect(done.getByRole('status')).toBeVisible();
    expect(await clippedInShadows(page)).toEqual([]);
  });

  test('lays out why the replay stopped without clipping', async ({ context }) => {
    await openShadowRoots(context);
    await routePages(context, 'broken');
    await stubChrome(context, running(), 'de');
    const page = await context.newPage();
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto(`${ORIGIN}/login`);
    expect(await verdict(page)).toMatchObject({ kind: 'diverged' });
    await expect(page.locator('#piwi-replay-hud-host').getByRole('region')).toHaveAttribute('lang', 'de');
    await expect(page.locator('#piwi-replay-hud-host').getByRole('status')).toBeVisible();
    expect(await clippedInShadows(page)).toEqual([]);
  });

  test('lays out the dialog, its errors and a chosen report without clipping', async ({ context }) => {
    await openShadowRoots(context);
    await routePages(context, 'buggy');
    await stubChrome(context, {}, 'de');
    const page = await context.newPage();
    await page.goto(`${ORIGIN}/login`);

    const dialog = page
      .locator('#piwi-replay-dialog-host')
      .getByRole('dialog', { name: catalog.replay_dialogTitle!.message });
    await expect(dialog).toHaveAttribute('lang', 'de');
    expect(await clippedInShadows(page)).toEqual([]);
    await dialog.getByRole('button', { name: catalog.replay_start!.message, exact: true }).click();
    await expect(dialog.getByRole('alert')).toBeVisible();
    expect(await clippedInShadows(page)).toEqual([]);

    const file = dialog.getByLabel(catalog.replay_fileLabel!.message);
    await file.setInputFiles({ name: 'notes.json', mimeType: 'application/json', buffer: Buffer.from('{"a":1}') });
    await expect(dialog.getByRole('alert')).toContainText('notes.json');
    expect(await clippedInShadows(page)).toEqual([]);

    await file.setInputFiles({
      name: 'steps.json',
      mimeType: 'application/json',
      buffer: Buffer.from(JSON.stringify(REPORT)),
    });
    await expect(dialog).toContainText(REPORT.origin!);
    // Step by step, and starting from this page instead of the report's first one.
    await expect(dialog.getByRole('checkbox')).toHaveCount(2);
    await expect(dialog).toContainText('/login');
    expect(await clippedInShadows(page)).toEqual([]);
  });
});
