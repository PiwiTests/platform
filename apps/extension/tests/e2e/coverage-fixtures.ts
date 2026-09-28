import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext, Page } from '@playwright/test';
import type { LocatorIndex, LocatorIndexTestStatus } from '@piwitests/core/locator-index';
import { PAGES_DIR, servePages } from './engine-bundle.js';
import { stubChromeI18n } from './i18n-stub.js';

const here = path.dirname(fileURLToPath(import.meta.url));
export const DIST = path.join(here, '..', '..', 'dist');
export const SHOP_ORIGIN = 'https://shop.test';
export const INSTANCE_URL = 'https://piwi.test';

interface TestSpec {
  title: string;
  suite: string[];
  file: string;
  status: LocatorIndexTestStatus | null;
  /** Each use, with the pages its calls ran on (`[page key, on arrival]`) when the capture fixtures recorded them. */
  uses: Array<[locator: string, actions: string[], line: number, pages?: Array<[page: string, arrival: boolean]>]>;
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

/**
 * Tests using brittle locators on the shop page: by position and styling
 * classes (the Red mug's button), by a child combinator (Checkout), and by
 * classes matching every card's button.
 */
export const BRITTLE_TESTS: TestSpec[] = [
  {
    title: 'adds the red mug',
    suite: ['legacy'],
    file: 'tests/legacy.spec.ts',
    status: 'flaky',
    uses: [["locator('.grid .primary').nth(1)", ['click'], 12]],
  },
  {
    title: 'checks out',
    suite: ['legacy'],
    file: 'tests/legacy.spec.ts',
    status: 'passed',
    uses: [["locator('aside.cart > button')", ['click'], 20]],
  },
  {
    title: 'counts the buttons',
    suite: ['legacy'],
    file: 'tests/legacy.spec.ts',
    status: 'passed',
    uses: [["locator('.card .primary')", ['count'], 25]],
  },
];

/**
 * Tests whose calls recorded the page they ran on (the shop page is
 * `/shop.html`): a button this page no longer has, used as it loads, a menu
 * item used after an interaction, a negative assertion, a click on a name
 * four buttons share, and a button used only on another page.
 */
export const PAGE_TESTS: TestSpec[] = [
  {
    title: 'pays in one click',
    suite: ['checkout'],
    file: 'tests/one-click.spec.ts',
    status: 'passed',
    uses: [
      ["getByRole('button', { name: 'Pay now' })", ['click'], 8, [['/shop.html', true]]],
      ["getByText('Out of stock')", ['expect.not.toBeVisible'], 9, [['/shop.html', true]]],
    ],
  },
  {
    title: 'signs out',
    suite: ['account'],
    file: 'tests/account.spec.ts',
    status: 'failed',
    uses: [["getByRole('menuitem', { name: 'Sign out' })", ['click'], 14, [['/shop.html', false]]]],
  },
  {
    title: 'adds the first mug it sees',
    suite: ['catalog'],
    file: 'tests/quick-add.spec.ts',
    status: 'passed',
    uses: [["getByRole('button', { name: 'Add to cart' })", ['click'], 6, [['/shop.html', true]]]],
  },
  {
    title: 'subscribes from the newsletter page',
    suite: ['newsletter'],
    file: 'tests/newsletter.spec.ts',
    status: 'passed',
    uses: [["getByRole('button', { name: 'Subscribe' })", ['click'], 11, [['/newsletter', true]]]],
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
  const pages: string[] = [];
  const pageAt = (page: string) => {
    if (!pages.includes(page)) pages.push(page);
    return pages.indexOf(page);
  };
  tests.forEach((test, i) => {
    for (const [locator, actions, line, onPages] of test.uses) {
      let entry = locators.get(locator);
      if (!entry) locators.set(locator, (entry = { locator, lastSeenAt: '2026-09-25T10:00:00.000Z', uses: [] }));
      entry.uses.push({
        test: i,
        actions,
        callSites: [`${test.file}:${line}:5`],
        projects: ['chromium'],
        branches: ['main'],
        ...(onPages?.length
          ? {
              pages: onPages.map(([page]) => pageAt(page)),
              arrival: onPages.filter(([, arrival]) => arrival).map(([page]) => pageAt(page)),
            }
          : {}),
      });
    }
  });
  const base: LocatorIndex = {
    projectId: 1,
    projectName: 'acme-mugs',
    branch: 'main',
    defaultBranch: 'main',
    branches: [],
    builtAt: '2026-09-20T08:00:00.000Z',
    generatedAt: '2026-09-25T10:00:00.000Z',
    testIdAttributes: null,
    ...(pages.length ? { pages } : {}),
    tests: tests.map((t, i) => ({ id: 100 + i, title: t.title, suite: t.suite, file: t.file, status: t.status })),
    locators: [...locators.values()].sort((a, b) => b.uses.length - a.uses.length),
    truncated: false,
  };
  return { ...base, ...extra };
}

export interface CoverageStubOptions {
  /** Connection settings; null for a not-connected extension. */
  connection?: {
    instanceUrl: string;
    apiKey: string;
    projectMappings: Array<{
      urlPattern: string;
      projectId: number;
      projectLabel: string;
      branch?: string;
      pathPrefix?: string;
    }>;
  } | null;
  /** The index already cached for project 1, if any. */
  cached?: LocatorIndex | null;
  /** Indexes of project 1 cached for other branches, by branch. */
  cachedBranches?: Record<string, LocatorIndex>;
  /** What the worker answers to `piwi-refresh-locator-index`. */
  refresh?: unknown;
  /** The catalog `chrome.i18n` serves: English unless set. */
  language?: string;
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
  const cache: Record<string, { index: LocatorIndex; fetchedAt: number }> = {};
  if (cached) cache['1'] = { index: cached, fetchedAt: Date.now() };
  for (const [branch, index] of Object.entries(options.cachedBranches ?? {})) {
    cache[`1@${branch}`] = { index, fetchedAt: Date.now() };
  }
  if (Object.keys(cache).length) local.piwiLocatorIndexCache = cache;
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
  await stubChromeI18n(context, options.language);
}

export async function openShop(page: Page, query = ''): Promise<void> {
  await servePages(page, SHOP_ORIGIN);
  await page.goto(`${SHOP_ORIGIN}/shop.html${query}`);
  await page.frameLocator('#chat').getByRole('button', { name: 'Send' }).waitFor();
}

/**
 * Opens the shop as a deployment serving it under `prefix` (`/app/shop.html`)
 * would: every page is served both under the prefix and at the root.
 */
export async function openShopUnder(page: Page, prefix: string, query = ''): Promise<void> {
  const { readFileSync } = await import('node:fs');
  await page.route(`${SHOP_ORIGIN}/**`, async (route) => {
    let pathname = new URL(route.request().url()).pathname;
    if (pathname.startsWith(`${prefix}/`)) pathname = pathname.slice(prefix.length);
    try {
      const body = readFileSync(path.join(PAGES_DIR, pathname.replace(/^\//, '') || 'index.html'), 'utf8');
      await route.fulfill({ contentType: 'text/html', body });
    } catch {
      await route.fulfill({ status: 404, body: 'not found' });
    }
  });
  await page.goto(`${SHOP_ORIGIN}${prefix}/shop.html${query}`);
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
  uncovered: Array<{ description: string; eid: string | null; elsewhere: string[] }>;
  /** The key of the page open, and whether the view counts only what tests do on it. */
  page: string | null;
  prefixRemoved: string | null;
  pageScoped: boolean;
  missing: Array<{ locator: string; arrival: boolean; actions: string[]; tests: string[] }>;
  several: Array<{ locator: string; count: number; actions: string[]; tests: string[] }>;
  tests: Array<{ title: string; elements: number }>;
  /** Brittle chains finding something here, most urgent first. */
  brittle: Array<{
    locator: string;
    rules: string[];
    elements: string[];
    count: number;
    tests: string[];
    callSites: string[];
    replacement: { recommended: string; durable: string | null } | 'add-test-id' | null;
  }>;
  /** The element the view is limited to, as the lists describe it. */
  scope: string | null;
  /** While choosing that element: the one that would be chosen ('' for none yet); null otherwise. */
  choosing: string | null;
  /** The branch read: a name, `*` for every branch, null for the default branch. */
  branch: string | null;
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
