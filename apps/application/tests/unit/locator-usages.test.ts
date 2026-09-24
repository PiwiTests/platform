import { describe, test, expect, beforeEach } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
const { upsertLocatorUsages, getExecutionLocators, getLocatorUsages, backfillLocatorUsages } =
  await import('../../server/utils/locator-usages');

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

async function seedCase(id: number, title: string, filePath = 'tests/checkout.spec.ts'): Promise<number> {
  await db.insert(schema.testCases).values({ id, projectId: 1, filePath, title });
  return id;
}

async function seedRun(): Promise<number> {
  const id = ++runSeq;
  await db.insert(schema.testRuns).values({ id, projectId: 1, status: 'passed', startTime: new Date(id) });
  return id;
}

async function seedExecution(runId: number, testCaseId: number, steps: unknown[]): Promise<number> {
  const [row] = await db
    .insert(schema.testRunsCases)
    .values({ testRunId: runId, testCaseId, status: 'passed', steps })
    .returning({ id: schema.testRunsCases.id });
  return row!.id;
}

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
      {
        caseId: 1,
        filePath: 'tests/checkout.spec.ts',
        runId,
        complete: true,
        steps: [
          step('Fill "Jane Secret"', `${SHIPPING}.getByLabel('Name')`, 'pages/shipping.page.ts:37:5'),
          step('Select option', COUNTRY, 'pages/shipping.page.ts:41:5'),
          step('Select option', COUNTRY, 'pages/shipping.page.ts:41:5'),
          { title: "Click getByRole('button', { name: 'Pay' })", location: `${ROOT}tests/checkout.spec.ts:20:3` },
        ],
      },
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
    const steps = [step('Click', "getByRole('button', { name: 'Pay' })", 'tests/checkout.spec.ts:20:3')];
    await upsertLocatorUsages(db as never, 1, [
      { caseId: 1, filePath: 'tests/checkout.spec.ts', runId: first, complete: true, steps },
    ]);
    await upsertLocatorUsages(db as never, 1, [
      { caseId: 1, filePath: 'tests/checkout.spec.ts', runId: second, complete: true, steps },
    ]);
    const [row] = await usages();
    expect([row!.firstSeenRunId, row!.lastSeenRunId]).toEqual([first, second]);
  });

  test('a complete execution drops uses the test no longer has; an incomplete one keeps them', async () => {
    await seedCase(1, 'pays by card');
    const runId = await seedRun();
    const pay = step('Click', "getByRole('button', { name: 'Pay' })", 'tests/checkout.spec.ts:20:3');
    const back = step('Click', "getByRole('link', { name: 'Back' })", 'tests/checkout.spec.ts:21:3');
    await upsertLocatorUsages(db as never, 1, [
      { caseId: 1, filePath: 'tests/checkout.spec.ts', runId, complete: true, steps: [pay, back] },
    ]);

    await upsertLocatorUsages(db as never, 1, [
      { caseId: 1, filePath: 'tests/checkout.spec.ts', runId, complete: false, steps: [pay] },
    ]);
    expect((await usages()).length).toBe(2);

    await upsertLocatorUsages(db as never, 1, [
      { caseId: 1, filePath: 'tests/checkout.spec.ts', runId, complete: true, steps: [pay] },
    ]);
    expect((await usages()).map((r) => r.locator)).toEqual(["getByRole('button', { name: 'Pay' })"]);
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

    // The index is empty, so the first read builds it from the stored executions.
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

  test('returns null for an unknown execution', async () => {
    expect(await getExecutionLocators(db as never, 999)).toBeNull();
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
