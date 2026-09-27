import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import type { PiwiSteps } from '@piwitests/core/steps';
import { test, expect } from './fixtures.js';
import { stubChromeI18n } from './i18n-stub.js';
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
      runtime: { sendMessage: async () => ({ ok: true }), onMessage: { addListener: () => undefined } },
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

function running(stepMode = false): Record<string, unknown> {
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
    },
  };
}

async function replayState(
  page: Page,
): Promise<{ status: string; results: Array<{ status: string; detail: string | null }> }> {
  return page.evaluate(() => JSON.parse(window.name).session.piwiReplay);
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

    const file = dialog.getByLabel('Le .zip du rapport de bug, ou son steps.json');
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
