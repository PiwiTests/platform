import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import type { LocatorIndex, LocatorIndexTestStatus } from '@piwitests/core/locator-index';
import { servePages } from './engine-bundle.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIST = path.join(here, '..', '..', 'dist');
export const SHOP_ORIGIN = 'https://shop.test';
export const INSTANCE_URL = 'https://piwi.test';

interface TestSpec {
  title: string;
  suite: string[];
  file: string;
  status: LocatorIndexTestStatus | null;
  uses: Array<[locator: string, actions: string[], line: number]>;
}

/** The tests of the Acme Mugs project, as a Piwi instance would index them. */
export const SHOP_TESTS: TestSpec[] = [
  {
    title: 'finds a product by name',
    suite: ['search'],
    file: 'tests/search.spec.ts',
    status: 'passed',
    uses: [
      ["getByPlaceholder('Search products')", ['fill'], 5],
      ["getByRole('button', { name: 'Search' })", ['click'], 6],
    ],
  },
  {
    title: 'adds a mug to the cart',
    suite: ['catalog'],
    file: 'tests/catalog.spec.ts',
    status: 'passed',
    uses: [
      [
        "getByTestId('product-card').filter({ hasText: 'Blue mug' }).getByRole('button', { name: 'Add to cart' })",
        ['click'],
        9,
      ],
      ["getByRole('button', { name: /Cart, \\d+ items?/ })", ['expect.toBeVisible'], 10],
    ],
  },
  {
    title: 'filters in-stock products',
    suite: ['catalog'],
    file: 'tests/catalog.spec.ts',
    status: 'flaky',
    uses: [
      ["getByLabel('In stock')", ['check'], 18],
      ["getByRole('combobox', { name: 'Sort by' })", ['selectOption'], 19],
      ["getByRole('button', { name: 'Add to cart' })", ['count'], 20],
    ],
  },
  {
    title: 'pays by card',
    suite: ['checkout'],
    file: 'tests/checkout.spec.ts',
    status: 'failed',
    uses: [
      ["getByRole('button', { name: 'Checkout' })", ['click'], 7],
      ["getByRole('heading', { name: 'Your cart' })", ['expect.toBeVisible'], 6],
      ["getByRole('button', { name: 'Log in' })", ['click'], 12],
      ["getByLabel('Password')", ['fill'], 13],
    ],
  },
  {
    title: 'accepts the cookie banner',
    suite: ['privacy'],
    file: 'tests/privacy.spec.ts',
    status: 'passed',
    uses: [
      ["getByRole('dialog', { name: 'We use cookies' }).getByRole('button', { name: 'Accept all' })", ['click'], 4],
    ],
  },
  {
    title: 'rates a product',
    suite: ['catalog', 'ratings'],
    file: 'tests/ratings.spec.ts',
    status: 'passed',
    uses: [["locator('rating-stars').getByRole('button', { name: '4 stars' })", ['click'], 8]],
  },
  {
    title: 'opens the support chat',
    suite: ['support'],
    file: 'tests/support.spec.ts',
    status: 'skipped',
    uses: [
      ["locator('#chat').contentFrame().getByRole('textbox', { name: 'Message' })", ['fill'], 5],
      ["locator('#chat').contentFrame().getByRole('button', { name: 'Send' })", ['click'], 6],
    ],
  },
  {
    title: 'visits the deals',
    suite: ['navigation'],
    file: 'tests/nav.spec.ts',
    status: 'passed',
    uses: [["getByRole('navigation').getByRole('link', { name: 'Deals' })", ['click'], 3]],
  },
  {
    title: 'shows prices',
    suite: ['catalog'],
    file: 'tests/catalog.spec.ts',
    status: 'passed',
    uses: [
      ['getByText(/\\d+ €/)', ['count'], 30],
      ["locator('.card .price').first()", ['expect.toBeVisible'], 31],
    ],
  },
  {
    title: 'uses a layout locator',
    suite: ['legacy'],
    file: 'tests/legacy.spec.ts',
    status: null,
    uses: [['locator(\'button:left-of(:text("Apply"))\')', ['click'], 2]],
  },
];

/** A test checking the Blue mug card itself, around its buttons. */
export const CARD_TEST: TestSpec = {
  title: 'shows the Blue mug card',
  suite: ['catalog'],
  file: 'tests/catalog.spec.ts',
  status: 'passed',
  uses: [["getByTestId('product-card').filter({ hasText: 'Blue mug' })", ['expect.toBeVisible'], 40]],
};

export function shopIndex(tests: TestSpec[] = SHOP_TESTS, extra: Partial<LocatorIndex> = {}): LocatorIndex {
  const locators = new Map<string, LocatorIndex['locators'][number]>();
  tests.forEach((test, i) => {
    for (const [locator, actions, line] of test.uses) {
      let entry = locators.get(locator);
      if (!entry) locators.set(locator, (entry = { locator, lastSeenAt: '2026-09-25T10:00:00.000Z', uses: [] }));
      entry.uses.push({ test: i, actions, callSites: [`${test.file}:${line}:5`], projects: ['chromium'] });
    }
  });
  return {
    projectId: 1,
    projectName: 'acme-mugs',
    builtAt: '2026-09-20T08:00:00.000Z',
    generatedAt: '2026-09-25T10:00:00.000Z',
    testIdAttributes: null,
    tests: tests.map((t, i) => ({ id: 100 + i, title: t.title, suite: t.suite, file: t.file, status: t.status })),
    locators: [...locators.values()].sort((a, b) => b.uses.length - a.uses.length),
    truncated: false,
    ...extra,
  };
}

export interface CoverageStubOptions {
  /** Connection settings; null for a not-connected extension. */
  connection?: {
    instanceUrl: string;
    apiKey: string;
    projectMappings: Array<{ urlPattern: string; projectId: number; projectLabel: string }>;
  } | null;
  /** The index already cached for project 1, if any. */
  cached?: LocatorIndex | null;
  /** What the worker answers to `piwi-refresh-locator-index`. */
  refresh?: unknown;
}

export const DEFAULT_CONNECTION = {
  instanceUrl: INSTANCE_URL,
  apiKey: 'pd_test',
  projectMappings: [{ urlPattern: `${SHOP_ORIGIN}/**`, projectId: 1, projectLabel: 'Acme Mugs' }],
};

/**
 * Stubs the `chrome.*` APIs the overlay uses, in the page world where the
 * test injects the bundle: storage (settings, cached index), and a worker
 * answering pings, index refreshes and the settings shortcut. Messages sent
 * are recorded in `__piwiTestSent`; the refresh answer can be swapped through
 * `__piwiTestRefreshAnswer`. The overlay renders into an open shadow root so
 * tests can drive it.
 */
export async function stubCoverageChrome(context: BrowserContext, options: CoverageStubOptions = {}): Promise<void> {
  const connection = options.connection === undefined ? DEFAULT_CONNECTION : options.connection;
  const cached = options.cached === undefined ? shopIndex() : options.cached;
  const local: Record<string, unknown> = {};
  if (connection) local.piwiConnection = connection;
  if (cached) local.piwiLocatorIndexCache = { '1': { index: cached, fetchedAt: Date.now() } };
  await context.addInitScript(
    ({ localSeed, refresh }) => {
      const store: Record<'local' | 'session', Record<string, unknown>> = { local: { ...localSeed }, session: {} };
      const area = (name: 'local' | 'session') => ({
        get: async (key: string) => ({ [key]: store[name][key] }),
        set: async (values: Record<string, unknown>) => {
          Object.assign(store[name], values);
        },
        remove: async (key: string) => {
          delete store[name][key];
        },
      });
      const g = globalThis as Record<string, unknown>;
      const sent: unknown[] = [];
      g.__piwiTestSent = sent;
      g.__piwiTestRefreshAnswer = refresh;
      g.__piwiTestOpenShadow = true;
      g.chrome = {
        storage: { local: area('local'), session: area('session') },
        runtime: {
          sendMessage: async (message: { type?: string }) => {
            sent.push(message);
            if (message?.type === 'piwi-refresh-locator-index') return g.__piwiTestRefreshAnswer;
            return { ok: true };
          },
          onMessage: { addListener() {} },
        },
      };
    },
    { localSeed: local, refresh: options.refresh ?? { ok: true, refreshed: false, index: null } },
  );
}

export async function openShop(page: Page, query = ''): Promise<void> {
  await servePages(page, SHOP_ORIGIN);
  await page.goto(`${SHOP_ORIGIN}/shop.html${query}`);
  await page.frameLocator('#chat').getByRole('button', { name: 'Send' }).waitFor();
}

/** Injects the built overlay and waits until it settles on a status. */
export async function injectCoverage(page: Page, status = 'ready'): Promise<void> {
  await page.addScriptTag({ path: path.join(DIST, 'coverage-overlay.js') });
  await page.waitForFunction(
    (wanted) =>
      (globalThis as { __piwiCoverage?: { status?: string; scans?: number } }).__piwiCoverage?.status === wanted,
    status,
  );
}

export interface BridgedCoverage {
  status: string;
  message: string | null;
  projectLabel: string | null;
  scans: number;
  drawn: number;
  covered: Array<{
    description: string;
    eid: string | null;
    kind: 'operated' | 'checked';
    ambiguous: boolean;
    visible: boolean;
    tests: string[];
    locators: string[];
  }>;
  uncovered: Array<{ description: string; eid: string | null }>;
  tests: Array<{ title: string; elements: number }>;
  /** The element the view is limited to, as the lists describe it. */
  scope: string | null;
  /** While choosing that element: the one that would be chosen ('' for none yet); null otherwise. */
  choosing: string | null;
  /** Tested elements around the scope, nearest first. */
  containers: Array<{ description: string; tests: string[] }>;
  coveredInteractive: number;
  uncoveredCount: number;
  unmatched: number;
  errors: Array<{ locator: string; message: string }>;
  durationMs: number | null;
}

export async function readCoverage(page: Page): Promise<BridgedCoverage> {
  return page.evaluate(() => (globalThis as unknown as { __piwiCoverage: BridgedCoverage }).__piwiCoverage);
}
