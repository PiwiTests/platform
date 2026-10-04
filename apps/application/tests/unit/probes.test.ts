import { describe, test, expect } from 'vitest';
import {
  selectProbePlan,
  selectDependencyProbeItems,
  isProbeRun,
  isFlakeLabRun,
  isLabRun,
  notLabRun,
  PROBE_FAULTS,
  DEFAULT_PROBE_BUDGET,
  type ProbeCandidate,
} from '../../shared/handlers/probes';
import type { ServerProbeSettings } from '../../shared/server-probes';

const candidate = (over: Partial<ProbeCandidate>): ProbeCandidate => ({
  testCaseId: 1,
  testTitle: 't',
  filePath: 'tests/orders.spec.ts',
  suitePath: [],
  routeKey: 'POST /api/orders',
  exposure: 1,
  probed: false,
  changed: false,
  ...over,
});

describe('selectProbePlan', () => {
  test('picks unprobed pairs first, then by exposure', () => {
    const plan = selectProbePlan([
      candidate({ testCaseId: 1, routeKey: 'GET /api/a', exposure: 1, probed: false }),
      candidate({ testCaseId: 2, routeKey: 'GET /api/b', exposure: 9, probed: false }),
      candidate({ testCaseId: 3, routeKey: 'GET /api/c', exposure: 5, probed: true, changed: true }),
    ]);
    expect(plan.items.map((i) => i.testCaseId)).toEqual([2, 1, 3]);
  });

  test('excludes already-probed pairs unless they changed', () => {
    const plan = selectProbePlan([
      candidate({ testCaseId: 1, probed: true, changed: false }),
      candidate({ testCaseId: 2, routeKey: 'GET /api/b', probed: true, changed: true }),
    ]);
    expect(plan.items.map((i) => i.testCaseId)).toEqual([2]);
  });

  test('one fault per test per run', () => {
    const plan = selectProbePlan([
      candidate({ testCaseId: 1, routeKey: 'GET /api/a', exposure: 9 }),
      candidate({ testCaseId: 1, routeKey: 'GET /api/b', exposure: 8 }),
    ]);
    expect(plan.items).toHaveLength(1);
    expect(plan.items[0]!.routeKey).toBe('GET /api/a');
  });

  test('honors the budget', () => {
    const many = Array.from({ length: 10 }, (_, i) => candidate({ testCaseId: i + 1, routeKey: `GET /api/${i}` }));
    expect(selectProbePlan(many, { budget: 3 }).items).toHaveLength(3);
  });

  test('defaults to the standard budget', () => {
    const plan = selectProbePlan([candidate({})]);
    expect(plan.budget).toBe(DEFAULT_PROBE_BUDGET);
  });

  test('carries the file path and suite path onto plan items so the reporter matches on file, not title alone', () => {
    const plan = selectProbePlan([
      candidate({ testCaseId: 1, filePath: 'tests/orders.spec.ts', suitePath: ['Orders'] }),
    ]);
    expect(plan.items[0]!.filePath).toBe('tests/orders.spec.ts');
    expect(plan.items[0]!.suitePath).toEqual(['Orders']);
  });

  test('assigns a fault from the known set, spread across pairs', () => {
    const plan = selectProbePlan(
      Array.from({ length: PROBE_FAULTS.length }, (_, i) =>
        candidate({ testCaseId: i + 1, routeKey: `GET /api/${i}`, exposure: PROBE_FAULTS.length - i }),
      ),
    );
    expect(new Set(plan.items.map((i) => i.fault)).size).toBe(PROBE_FAULTS.length);
    for (const item of plan.items) expect(PROBE_FAULTS).toContain(item.fault);
  });
});

describe('selectDependencyProbeItems', () => {
  const settings = (over: Partial<ServerProbeSettings> = {}): ServerProbeSettings => ({
    enabled: true,
    faults: ['dependency'],
    routes: [],
    dependencyOnStateChanging: false,
    ...over,
  });

  test('emits a dependency fault for a route whose handler calls a dependency', () => {
    const items = selectDependencyProbeItems(
      [candidate({ testCaseId: 1, routeKey: 'GET /api/orders' })],
      new Map([['GET /api/orders', ['payments-svc']]]),
      settings(),
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ fault: 'dependency', level: 'server', dependency: 'payments-svc' });
  });

  test('skips routes whose handler calls no dependency', () => {
    const items = selectDependencyProbeItems(
      [candidate({ testCaseId: 1, routeKey: 'GET /api/orders' })],
      new Map(),
      settings(),
    );
    expect(items).toHaveLength(0);
  });

  test('honors the state-changing opt-in gate', () => {
    const deps = new Map([['POST /api/orders', ['payments-svc']]]);
    // A state-changing route needs the extra opt-in for a dependency fault.
    expect(selectDependencyProbeItems([candidate({ routeKey: 'POST /api/orders' })], deps, settings())).toHaveLength(0);
    expect(
      selectDependencyProbeItems(
        [candidate({ routeKey: 'POST /api/orders' })],
        deps,
        settings({ dependencyOnStateChanging: true }),
      ),
    ).toHaveLength(1);
  });

  test('emits nothing when the level or the dependency fault is disabled', () => {
    const deps = new Map([['GET /api/orders', ['payments-svc']]]);
    expect(selectDependencyProbeItems([candidate({})], deps, settings({ enabled: false }))).toHaveLength(0);
    expect(selectDependencyProbeItems([candidate({})], deps, settings({ faults: ['status'] as never }))).toHaveLength(
      0,
    );
  });

  test('excludes tests another plan already claimed', () => {
    const items = selectDependencyProbeItems(
      [candidate({ testCaseId: 1, routeKey: 'GET /api/orders' })],
      new Map([['GET /api/orders', ['payments-svc']]]),
      settings(),
      { exclude: new Set([1]) },
    );
    expect(items).toHaveLength(0);
  });
});

describe('isProbeRun', () => {
  test('is true only when the metadata carries the probe stamp', () => {
    expect(isProbeRun({ piwiProbe: true })).toBe(true);
    expect(isProbeRun({ piwiProbe: false })).toBe(false);
    expect(isProbeRun({})).toBe(false);
    expect(isProbeRun(null)).toBe(false);
    expect(isProbeRun(undefined)).toBe(false);
  });
});

describe('isFlakeLabRun and isLabRun', () => {
  const lab = { piwiFlakeLab: { experimentId: 'exp-1', armId: 'control' } };

  test('a flake-lab run carries the experiment and arm', () => {
    expect(isFlakeLabRun(lab)).toBe(true);
    expect(isFlakeLabRun({ piwiFlakeLab: null })).toBe(false);
    expect(isFlakeLabRun({ piwiFlakeLab: true })).toBe(false);
    expect(isFlakeLabRun({ piwiProbe: true })).toBe(false);
    expect(isFlakeLabRun(null)).toBe(false);
  });

  test('a lab run is a probe run or a flake-lab run', () => {
    expect(isLabRun(lab)).toBe(true);
    expect(isLabRun({ piwiProbe: true })).toBe(true);
    expect(isLabRun({ scm: { branch: 'main' } })).toBe(false);
    expect(isLabRun(undefined)).toBe(false);
  });
});

describe('notLabRun (SQLite)', () => {
  test('keeps real runs and drops probe and flake-lab runs, compact or spaced JSON', async () => {
    const { createClient } = await import('@libsql/client');
    const { drizzle } = await import('drizzle-orm/libsql');
    const { sql } = await import('drizzle-orm');
    const db = drizzle(createClient({ url: ':memory:' }));
    await db.run(sql`CREATE TABLE runs (id INTEGER, metadata TEXT)`);
    const rows: Array<[number, string | null]> = [
      [1, null],
      [2, JSON.stringify({ scm: { branch: 'main' } })],
      [3, JSON.stringify({ piwiProbe: true })],
      [4, JSON.stringify({ piwiFlakeLab: { experimentId: 'e', armId: 'a' } })],
      [5, '{"piwiFlakeLab": {"armId": "a", "experimentId": "e"}}'],
      [6, '{"piwiProbe": true}'],
    ];
    for (const [id, metadata] of rows) await db.run(sql`INSERT INTO runs VALUES (${id}, ${metadata})`);
    const kept = await db.all<{ id: number }>(
      sql`SELECT id FROM runs WHERE ${notLabRun(sql.raw('metadata'))} ORDER BY id`,
    );
    expect(kept.map((r) => r.id)).toEqual([1, 2]);
  });
});
