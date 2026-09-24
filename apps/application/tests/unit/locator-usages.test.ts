import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const { upsertLocatorUsages, getExecutionLocators, getLocatorUsages, backfillLocatorUsages } =
  await import('../../server/utils/locator-usages');
type LocatorUsageCase = import('../../server/utils/locator-usages').LocatorUsageCase;

let db: ReturnType<typeof drizzle<typeof schema>>;
let runSeq = 0;

const ROOT = '/work/shop/';

/** Steps as Playwright 1.63 reports them and the reporter stores them. */
const step = (title: string, locator: string, location: string) => ({
  title,
  category: 'action',
  duration: 5,
  subtitle: locator,
  params: { locator },
  location: `${ROOT}${location}`,
});

const SHIPPING = "getByRole('form', { name: 'Shipping' })";
const COUNTRY = `${SHIPPING}.getByLabel('Country')`;
const PAY = "getByRole('button', { name: 'Pay' })";

async function seedCase(id: number, title: string, filePath = 'tests/checkout.spec.ts'): Promise<number> {
  await db.insert(schema.testCases).values({ id, projectId: 1, filePath, title });
  return id;
}

/** A run, one minute after the previous one unless `startedAt` says otherwise. */
async function seedRun(opts: { startedAt?: Date; metadata?: Record<string, unknown> } = {}): Promise<number> {
  const id = ++runSeq;
  await db.insert(schema.testRuns).values({
    id,
    projectId: 1,
    status: 'passed',
    startTime: opts.startedAt ?? new Date(Date.UTC(2026, 0, 1) + id * 60_000),
    metadata: opts.metadata ?? null,
  });
  return id;
}

async function seedExecution(
  runId: number,
  testCaseId: number,
  steps: unknown[],
  opts: { status?: string; browserName?: string } = {},
): Promise<number> {
  const [row] = await db
    .insert(schema.testRunsCases)
    .values({
      testRunId: runId,
      testCaseId,
      status: opts.status ?? 'passed',
      steps,
      browserName: opts.browserName ?? 'chromium',
    })
    .returning({ id: schema.testRunsCases.id });
  return row!.id;
}

/** One execution for `upsertLocatorUsages`: a passed chromium run of test 1 by default. */
const exec = (runId: number, steps: unknown[], more: Partial<LocatorUsageCase> = {}): LocatorUsageCase => ({
  caseId: 1,
  browserName: 'chromium',
  filePath: 'tests/checkout.spec.ts',
  runId,
  complete: true,
  steps,
  ...more,
});

async function usages() {
  return db.select().from(schema.locatorUsages);
}

beforeEach(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values({ id: 1, name: 'locator-usages-project' });
  runSeq = 0;
});

describe('upsertLocatorUsages', () => {
  test('indexes chains, actions and project-relative call sites, never typed values', async () => {
    await seedCase(1, 'pays by card');
    const runId = await seedRun();
    await upsertLocatorUsages(db as never, 1, [
      exec(runId, [
        step('Fill "Jane Secret"', `${SHIPPING}.getByLabel('Name')`, 'pages/shipping.page.ts:37:5'),
        step('Select option', COUNTRY, 'pages/shipping.page.ts:41:5'),
        step('Select option', COUNTRY, 'pages/shipping.page.ts:41:5'),
        { title: "Click getByRole('button', { name: 'Pay' })", location: `${ROOT}tests/checkout.spec.ts:20:3` },
      ]),
    ]);
    const rows = await usages();
    expect(rows.map((r) => [r.action, r.locator, r.target, r.callSite])).toEqual([
      ['fill', `${SHIPPING}.getByLabel('Name')`, "getByLabel('Name')", 'pages/shipping.page.ts:37:5'],
      ['selectOption', COUNTRY, "getByLabel('Country')", 'pages/shipping.page.ts:41:5'],
      [
        'click',
        "getByRole('button', { name: 'Pay' })",
        "getByRole('button', { name: 'Pay' })",
        'tests/checkout.spec.ts:20:3',
      ],
    ]);
    expect(JSON.stringify(rows)).not.toContain('Jane Secret');
  });

  test('keeps the first-seen run and moves the last-seen run', async () => {
    await seedCase(1, 'pays by card');
    const first = await seedRun();
    const second = await seedRun();
    const steps = [step('Click', PAY, 'tests/checkout.spec.ts:20:3')];
    await upsertLocatorUsages(db as never, 1, [exec(first, steps)]);
    await upsertLocatorUsages(db as never, 1, [exec(second, steps)]);
    const [row] = await usages();
    expect([row!.firstSeenRunId, row!.lastSeenRunId]).toEqual([first, second]);
  });

  test('a later complete execution drops uses the test no longer has; an incomplete one keeps them', async () => {
    await seedCase(1, 'pays by card');
    const first = await seedRun();
    const second = await seedRun();
    const pay = step('Click', PAY, 'tests/checkout.spec.ts:20:3');
    const back = step('Click', "getByRole('link', { name: 'Back' })", 'tests/checkout.spec.ts:21:3');
    await upsertLocatorUsages(db as never, 1, [exec(first, [pay, back])]);

    await upsertLocatorUsages(db as never, 1, [exec(second, [pay], { complete: false })]);
    expect((await usages()).length).toBe(2);

    await upsertLocatorUsages(db as never, 1, [exec(second, [pay])]);
    expect((await usages()).map((r) => r.locator)).toEqual([PAY]);
  });

  test('a Playwright project only drops the uses it recorded itself', async () => {
    await seedCase(1, 'opens the menu');
    const first = await seedRun();
    const second = await seedRun();
    const pay = step('Click', PAY, 'tests/checkout.spec.ts:20:3');
    const menu = step('Click', "getByRole('button', { name: 'Menu' })", 'tests/checkout.spec.ts:19:3');
    await upsertLocatorUsages(db as never, 1, [
      exec(first, [pay]),
      exec(first, [menu, pay], { browserName: 'mobile-safari' }),
    ]);
    // The next run's batches land one project at a time.
    await upsertLocatorUsages(db as never, 1, [exec(second, [menu, pay], { browserName: 'mobile-safari' })]);
    await upsertLocatorUsages(db as never, 1, [exec(second, [pay])]);

    const rows = await usages();
    expect(rows.map((r) => `${r.browserName} ${r.locator}`).sort()).toEqual([
      `chromium ${PAY}`,
      "mobile-safari getByRole('button', { name: 'Menu' })",
      `mobile-safari ${PAY}`,
    ]);
  });

  test('an old report imported late never rolls the index back', async () => {
    await seedCase(1, 'pays by card');
    const current = await seedRun();
    const imported = await seedRun({ startedAt: new Date(Date.UTC(2025, 0, 1)) });
    const pay = step('Click', PAY, 'tests/checkout.spec.ts:20:3');
    const legacy = step('Click', "getByRole('button', { name: 'Checkout' })", 'tests/checkout.spec.ts:20:3');
    await upsertLocatorUsages(db as never, 1, [exec(current, [pay])]);
    await upsertLocatorUsages(db as never, 1, [exec(imported, [legacy])]);

    const rows = await usages();
    expect(rows.find((r) => r.locator === PAY)?.lastSeenRunId).toBe(current);
    // The older run adds what it saw, but can't remove a use seen after it.
    expect(rows.map((r) => r.locator).sort()).toEqual([PAY, "getByRole('button', { name: 'Checkout' })"].sort());

    await upsertLocatorUsages(db as never, 1, [exec(imported, [pay])]);
    expect((await usages()).find((r) => r.locator === PAY)?.lastSeenRunId).toBe(current);
  });

  test('the working directory sent with the run makes page-object call sites relative', async () => {
    await seedCase(1, 'pays by card');
    const runId = await seedRun({ metadata: { workingDir: '/work/shop' } });
    await upsertLocatorUsages(db as never, 1, [
      exec(runId, [step('Select option', COUNTRY, 'pages/shipping.page.ts:41:5')]),
    ]);
    expect((await usages()).map((r) => r.callSite)).toEqual(['pages/shipping.page.ts:41:5']);
  });

  test('a call site that cannot be made relative is left out, and its execution removes nothing', async () => {
    await seedCase(1, 'pays by card');
    const first = await seedRun();
    const second = await seedRun();
    await upsertLocatorUsages(db as never, 1, [exec(first, [step('Click', PAY, 'tests/checkout.spec.ts:20:3')])]);
    // Every step behind a page object, no working directory: the root is unknown.
    await upsertLocatorUsages(db as never, 1, [
      exec(second, [step('Select option', COUNTRY, 'pages/shipping.page.ts:41:5')]),
    ]);
    const rows = await usages();
    expect(rows.map((r) => r.locator)).toEqual([PAY]);
    expect(rows.every((r) => !r.callSite.startsWith('/'))).toBe(true);
  });

  test('chains over the byte budget are left out', async () => {
    await seedCase(1, 'reads a long label');
    const runId = await seedRun();
    const long = `getByText('${'文'.repeat(400)}')`;
    await upsertLocatorUsages(db as never, 1, [
      exec(runId, [
        step('Click', long, 'tests/checkout.spec.ts:20:3'),
        step('Click', PAY, 'tests/checkout.spec.ts:21:3'),
      ]),
    ]);
    expect((await usages()).map((r) => r.locator)).toEqual([PAY]);
  });
});

describe('getExecutionLocators', () => {
  test('lists uses in step order with how many tests share the chain and the target', async () => {
    await seedCase(1, 'pays by card');
    await seedCase(2, 'saves an address', 'tests/address.spec.ts');
    await seedCase(3, 'picks a country', 'tests/address.spec.ts');
    const runId = await seedRun();
    const execution = await seedExecution(runId, 1, [
      step('Select option', COUNTRY, 'pages/shipping.page.ts:41:5'),
      step('Select option', COUNTRY, 'pages/shipping.page.ts:41:5'),
      step('Click', "getByRole('button', { name: 'Pay' })", 'tests/checkout.spec.ts:20:3'),
    ]);
    await seedExecution(runId, 2, [step('Select option', COUNTRY, 'pages/shipping.page.ts:41:5')]);
    await seedExecution(runId, 3, [step('Click', "getByLabel('Country')", 'tests/address.spec.ts:18:3')]);

    await backfillLocatorUsages(db as never, 1);
    const result = await getExecutionLocators(db as never, execution);
    expect(result?.uses).toEqual([
      expect.objectContaining({
        stepIndex: 0,
        occurrences: 2,
        action: 'selectOption',
        locator: COUNTRY,
        target: "getByLabel('Country')",
        scopes: [SHIPPING],
        callSite: 'pages/shipping.page.ts:41:5',
        sameLocatorTests: 2,
        sameTargetTests: 3,
      }),
      expect.objectContaining({ stepIndex: 2, action: 'click', sameLocatorTests: 1, sameTargetTests: 1 }),
    ]);
  });

  test('never builds the index itself', async () => {
    await seedCase(1, 'pays by card');
    const runId = await seedRun();
    const execution = await seedExecution(runId, 1, [step('Click', PAY, 'tests/checkout.spec.ts:20:3')]);
    const result = await getExecutionLocators(db as never, execution);
    expect(result?.uses[0]).toMatchObject({ locator: PAY, sameLocatorTests: 0 });
    expect(await usages()).toEqual([]);
  });

  test('returns null for an unknown execution', async () => {
    expect(await getExecutionLocators(db as never, 999)).toBeNull();
  });
});

describe('backfillLocatorUsages', () => {
  test('indexes the latest passed execution per test and project, skips probe runs, and marks the project', async () => {
    await seedCase(1, 'pays by card');
    const passed = await seedRun();
    const failed = await seedRun();
    const probe = await seedRun({ metadata: { piwiProbe: true } });
    await seedExecution(passed, 1, [step('Click', PAY, 'tests/checkout.spec.ts:20:3')]);
    await seedExecution(
      failed,
      1,
      [step('Click', "getByRole('link', { name: 'Cart' })", 'tests/checkout.spec.ts:18:3')],
      {
        status: 'failed',
      },
    );
    await seedExecution(probe, 1, [
      step('Click', "getByRole('button', { name: 'Retry' })", 'tests/checkout.spec.ts:22:3'),
    ]);
    await seedExecution(
      failed,
      1,
      [step('Click', "getByRole('button', { name: 'Menu' })", 'tests/checkout.spec.ts:19:3')],
      {
        status: 'failed',
        browserName: 'mobile-safari',
      },
    );

    await backfillLocatorUsages(db as never, 1);

    expect((await usages()).map((r) => `${r.browserName} ${r.locator}`).sort()).toEqual([
      `chromium ${PAY}`,
      "mobile-safari getByRole('button', { name: 'Menu' })",
    ]);
    const [project] = await db.select().from(schema.projects);
    expect(project!.locatorIndexBuiltAt).toBeInstanceOf(Date);
  });
});

describe('getLocatorUsages', () => {
  beforeEach(async () => {
    await seedCase(1, 'pays by card');
    await seedCase(2, 'saves an address', 'tests/address.spec.ts');
    await seedCase(3, 'picks a country', 'tests/address.spec.ts');
    const runId = await seedRun();
    await seedExecution(runId, 1, [step('Select option', COUNTRY, 'pages/shipping.page.ts:41:5')]);
    await seedExecution(runId, 2, [
      step('Select option', COUNTRY, 'pages/shipping.page.ts:41:5'),
      step('Fill "x"', `${SHIPPING}.getByLabel('City')`, 'pages/shipping.page.ts:44:5'),
    ]);
    await seedExecution(runId, 3, [step('Click', "getByLabel('Country')", 'tests/address.spec.ts:18:3')]);
    await backfillLocatorUsages(db as never, 1);
  });

  test('locator: one call site shared by two tests', async () => {
    const result = await getLocatorUsages(db as never, 1, 'locator', COUNTRY);
    expect(result.testCount).toBe(2);
    expect(result.sites).toHaveLength(1);
    expect(result.sites[0]).toMatchObject({ callSite: 'pages/shipping.page.ts:41:5', actions: ['selectOption'] });
    expect(result.sites[0]!.tests.map((t) => t.title).sort()).toEqual(['pays by card', 'saves an address']);
  });

  test('target: every chain ending on the same call, whatever its container', async () => {
    const result = await getLocatorUsages(db as never, 1, 'target', "getByLabel('Country')");
    expect(result.testCount).toBe(3);
    expect(result.sites.map((s) => s.callSite)).toEqual(['pages/shipping.page.ts:41:5', 'tests/address.spec.ts:18:3']);
  });

  test('scope: every chain that searches inside a container', async () => {
    const result = await getLocatorUsages(db as never, 1, 'scope', SHIPPING);
    expect(result.sites.map((s) => s.locator).sort()).toEqual([`${SHIPPING}.getByLabel('City')`, COUNTRY]);
    expect(result.testCount).toBe(2);
  });

  test('scope matching is a case-sensitive prefix', async () => {
    const result = await getLocatorUsages(db as never, 1, 'scope', "getByRole('form', { name: 'shipping' })");
    expect(result.testCount).toBe(0);
  });

  test('search: text inside any chain, ignoring case', async () => {
    const result = await getLocatorUsages(db as never, 1, 'search', 'city');
    expect(result.sites.map((s) => s.locator)).toEqual([`${SHIPPING}.getByLabel('City')`]);
  });

  test('search treats LIKE wildcards literally', async () => {
    expect((await getLocatorUsages(db as never, 1, 'search', '%')).testCount).toBe(0);
  });
});
