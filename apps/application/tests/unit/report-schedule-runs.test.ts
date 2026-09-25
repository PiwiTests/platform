import { beforeAll, beforeEach, describe, expect, test } from 'vitest';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/libsql';
import { migrate } from 'drizzle-orm/libsql/migrator';
import { createClient } from '@libsql/client';
import { eq } from 'drizzle-orm';
import * as schema from '../../server/database/schema.sqlite';

delete process.env.PIWI_DATABASE_URL;
delete process.env.PIWI_CI_MINUTE_COST;
const reports = await import('../../shared/handlers/reports');
const { backfillDailyRollups } = await import('../../shared/handlers/analytics/rollups');
const { collectReportBundle } = await import('../../shared/reports/collect');
const { parseAnalyticsScope } = await import('../../shared/analytics/scope');
const { reportWidgets } = await import('../../shared/reports/types');
const { runAnalyticsWidget } = await import('../../shared/handlers/analytics');
const { REPORT_READY_EVENT } = await import('../../shared/notification-events');

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = Date.parse('2026-09-24T12:00:00Z');
let db: ReturnType<typeof drizzle<typeof schema>>;

const admin = { id: null, isAdmin: true, authEnabled: false };

async function channels() {
  return reports.loadReportChannels(db as any);
}

beforeAll(async () => {
  db = drizzle(createClient({ url: ':memory:' }), { schema });
  await migrate(db, { migrationsFolder: fileURLToPath(new URL('../../server/database/migrations', import.meta.url)) });
  await db.insert(schema.projects).values([
    { id: 1, name: 'checkout' },
    { id: 2, name: 'search', capabilities: { 'test-map': 'declined' } },
  ]);
  await db.insert(schema.users).values([
    { id: 10, username: 'admin', password: '', email: 'admin@example.test', role: 'administrator' },
    { id: 11, username: 'reporter', password: '', email: 'reporter@example.test', role: 'reporter' },
  ]);
  await db.insert(schema.notificationChannels).values([
    { id: 1, name: 'Team mail', type: 'email', config: { address: 'team@example.test' }, userId: null },
    { id: 2, name: 'Slack', type: 'slack', config: { webhookUrl: 'https://hooks.example.test/x' }, userId: null },
    { id: 3, name: 'My mail', type: 'email', config: { address: 'me@example.test' }, userId: 11 },
  ]);
  const run = (projectId: number, daysAgo: number, passed: number) =>
    db.insert(schema.testRuns).values({
      projectId,
      status: passed === 10 ? 'passed' : 'failed',
      startTime: new Date(NOW - daysAgo * DAY_MS),
      duration: 60_000,
      totalTests: 10,
      passedTests: passed,
      failedTests: 10 - passed,
      isFullRun: 1,
    });
  await run(1, 3, 9);
  await run(2, 4, 10);
  await backfillDailyRollups(db as any);
  await db.insert(schema.scenarioGaps).values([
    {
      projectId: 1,
      detector: 'success-only',
      class: 'blind-spot',
      key: 'a',
      title: 'POST /api/orders only succeeds',
      score: 0.8,
      createdAt: new Date(NOW - 2 * DAY_MS),
    },
    {
      projectId: 2,
      detector: 'success-only',
      class: 'fragile',
      key: 'b',
      title: 'Search declined gap',
      score: 0.9,
      createdAt: new Date(NOW - 2 * DAY_MS),
    },
  ] as any);
});

beforeEach(async () => {
  await db.delete(schema.notificationDeliveries);
  await db.delete(schema.reportSnapshots);
  await db.delete(schema.reportSchedules);
});

async function createWeekly(extra: Partial<Parameters<typeof reports.createReportSchedule>[1]> = {}) {
  return reports.createReportSchedule(
    db as any,
    reports.parseScheduleBody(reports.reportScheduleInputSchema, {
      name: 'Weekly',
      dashboard: 'executive',
      cadence: 'weekly',
      anchor: 1,
      at: '08:00',
      channelIds: [1, 2],
      ...extra,
    }),
    { actor: admin, channels: await channels(), access: 'all', timeZone: 'UTC', now: NOW - 30 * DAY_MS },
  );
}

describe('report schedules', () => {
  test('a new schedule fires at its next scheduled instant', async () => {
    const view = await createWeekly();
    expect(view.global).toBe(true);
    expect(view.dashboardName).toBe('Executive');
    expect(new Date(view.nextRunAt!).getUTCDay()).toBe(1);
    expect(view.channels.map((c) => c.name)).toEqual(['Team mail', 'Slack']);
  });

  test('the sweep stores a snapshot and queues one report.ready row per channel, once', async () => {
    const view = await createWeekly();
    const runAt = Date.parse('2026-09-21T08:00:00Z');
    await db
      .update(schema.reportSchedules)
      .set({ nextRunAt: new Date(runAt) })
      .where(eq(schema.reportSchedules.id, view.id));

    const ctx = { timeZone: 'UTC', deliver: true, now: NOW, accessFor: async () => 'all' as const };
    expect(await reports.sweepReportSchedules(db as any, ctx)).toEqual({ fired: 1, failed: 0 });
    const rows = await db.select().from(schema.notificationDeliveries);
    expect(rows.map((r) => r.dedupeKey).sort()).toEqual([
      `report:${view.id}:2026-09-20:1`,
      `report:${view.id}:2026-09-20:2`,
    ]);
    expect(rows.every((r) => r.event === REPORT_READY_EVENT && r.subscriptionId === null)).toBe(true);

    const [snapshot] = await db.select().from(schema.reportSnapshots);
    expect(snapshot!.scheduleId).toBe(view.id);
    expect(snapshot!.projectIds).toEqual([1, 2]);
    expect(new Date(snapshot!.periodFrom).toISOString()).toBe('2026-09-14T00:00:00.000Z');
    expect(new Date(snapshot!.periodTo).toISOString()).toBe('2026-09-21T00:00:00.000Z');

    // The next firing moved on; running the same period again queues nothing new.
    const [after] = await db.select().from(schema.reportSchedules);
    expect(new Date(after!.nextRunAt!).toISOString()).toBe('2026-09-28T08:00:00.000Z');
    await reports.runReportSchedule(db as any, after!, { ...ctx, access: 'all', runAt });
    expect(await db.select().from(schema.notificationDeliveries)).toHaveLength(2);
  });

  test('a period without runs still sends', async () => {
    const view = await createWeekly();
    const [row] = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, view.id));
    const result = await reports.runReportSchedule(db as any, row!, {
      access: 'all',
      timeZone: 'UTC',
      deliver: true,
      now: NOW,
      runAt: Date.parse('2026-08-03T08:00:00Z'),
    });
    expect(result.queued).toBe(2);
    const snapshot = await reports.getReportSnapshot(db as any, result.snapshotId, 'all');
    expect(snapshot.verdict.sentence).toBe('No runs were recorded for this scope in the period.');
  });

  test('a muted schedule keeps its snapshot and sends nothing', async () => {
    const view = await createWeekly({ mutedUntil: new Date(NOW + DAY_MS).toISOString() });
    const [row] = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, view.id));
    const result = await reports.runReportSchedule(db as any, row!, {
      access: 'all',
      timeZone: 'UTC',
      deliver: true,
      now: NOW,
    });
    expect(result).toMatchObject({ muted: true, queued: 0 });
    expect(await db.select().from(schema.reportSnapshots)).toHaveLength(1);
  });

  test('run now delivers each click once, keyed by its snapshot', async () => {
    const view = await createWeekly();
    const ctx = { access: 'all' as const, timeZone: 'UTC', deliver: true, now: NOW };
    const first = await reports.runReportScheduleNow(db as any, view.id, admin, ctx);
    const second = await reports.runReportScheduleNow(db as any, view.id, admin, ctx);
    expect(first.period).toEqual({ from: '2026-09-14', to: '2026-09-20', firstRun: false });
    const keys = (await db.select().from(schema.notificationDeliveries)).map((r) => r.dedupeKey);
    expect(keys).toContain(`report:${view.id}:2026-09-20:1:run-${first.snapshotId}`);
    expect(keys).toContain(`report:${view.id}:2026-09-20:1:run-${second.snapshotId}`);
  });

  test('the first firing covers only the days since creation, and says so', async () => {
    const view = await reports.createReportSchedule(
      db as any,
      reports.parseScheduleBody(reports.reportScheduleInputSchema, {
        name: 'New',
        dashboard: 'executive',
        cadence: 'weekly',
        anchor: 1,
        at: '08:00',
        channelIds: [1],
      }),
      {
        actor: admin,
        channels: await channels(),
        access: 'all',
        timeZone: 'UTC',
        now: Date.parse('2026-09-16T15:00:00Z'),
      },
    );
    const [row] = await db.select().from(schema.reportSchedules).where(eq(schema.reportSchedules.id, view.id));
    const result = await reports.runReportSchedule(db as any, row!, {
      access: 'all',
      timeZone: 'UTC',
      deliver: false,
      now: NOW,
      runAt: new Date(row!.nextRunAt!).getTime(),
    });
    expect(result.period).toEqual({ from: '2026-09-16', to: '2026-09-20', firstRun: true });
    const snapshot = await reports.getReportSnapshot(db as any, result.snapshotId, 'all');
    expect(snapshot.bundle.limits[0]).toMatch(/^This first scheduled quality report covers only the days since/);
  });
});

describe('who may do what', () => {
  const reporter = { id: 11, isAdmin: false, authEnabled: true };

  test('a global schedule needs an administrator and global channels', async () => {
    const input = reports.parseScheduleBody(reports.reportScheduleInputSchema, {
      name: 'x',
      dashboard: 'executive',
      cadence: 'daily',
      at: '08:00',
      channelIds: [1],
      global: true,
    });
    const ctx = { actor: reporter, channels: await channels(), access: new Set([1]), timeZone: 'UTC' };
    await expect(reports.createReportSchedule(db as any, input, ctx)).rejects.toMatchObject({ statusCode: 403 });
    const adminCtx = { ...ctx, actor: { id: 10, isAdmin: true, authEnabled: true } };
    await expect(
      reports.createReportSchedule(db as any, { ...input, channelIds: [3] }, adminCtx),
    ).rejects.toMatchObject({ statusCode: 400, message: 'Global schedules require global channels' });
  });

  test('a reporter schedules only over projects they can open', async () => {
    const input = reports.parseScheduleBody(reports.reportScheduleInputSchema, {
      name: 'x',
      dashboard: 'executive',
      cadence: 'daily',
      at: '08:00',
      channelIds: [3],
      scope: { projects: '2' },
    });
    const ctx = { actor: reporter, channels: await channels(), access: new Set([1]), timeZone: 'UTC' };
    await expect(reports.createReportSchedule(db as any, input, ctx)).rejects.toMatchObject({ statusCode: 403 });
    const ok = await reports.createReportSchedule(db as any, { ...input, scope: { projects: '1' } }, ctx);
    expect(ok.global).toBe(false);
    expect(ok.ownerId).toBe(11);
  });

  test('the team dashboard needs an owner', async () => {
    const input = reports.parseScheduleBody(reports.reportScheduleInputSchema, {
      name: 'x',
      dashboard: 'team',
      cadence: 'daily',
      at: '08:00',
      channelIds: [1],
    });
    const ctx = { actor: admin, channels: await channels(), access: 'all' as const, timeZone: 'UTC' };
    await expect(reports.createReportSchedule(db as any, input, ctx)).rejects.toMatchObject({ statusCode: 400 });
    const ok = await reports.createReportSchedule(db as any, { ...input, scope: { owner: '@payments' } }, ctx);
    expect(ok.scope.owner).toBe('@payments');
  });

  test('a snapshot is readable only by who can open every project it covers', async () => {
    const view = await createWeekly();
    const { snapshotId } = await reports.runReportScheduleNow(db as any, view.id, admin, {
      access: 'all',
      timeZone: 'UTC',
      deliver: false,
      now: NOW,
    });
    await expect(reports.getReportSnapshot(db as any, snapshotId, new Set([1]))).rejects.toMatchObject({
      statusCode: 403,
    });
    expect(await reports.listReportSnapshots(db as any, new Set([1]))).toEqual([]);
    expect((await reports.listReportSnapshots(db as any, new Set([1, 2]))).map((s) => s.id)).toEqual([snapshotId]);
  });
});

describe('the Test Map widgets', () => {
  test('a project that declined the Test Map is left out', async () => {
    const data = (await runAnalyticsWidget(db as any, 'scenario-gaps', parseAnalyticsScope({}), 'all')) as any;
    expect(data.projects).toBe(1);
    expect(data.declined).toBe(1);
    expect(data.byClass).toEqual([{ class: 'blind-spot', count: 1 }]);
  });

  test('the gaps digest lists the new gaps of each project in the period', async () => {
    const bundle = await collectReportBundle(db as any, {
      dashboard: 'gaps-digest',
      scope: parseAnalyticsScope({ period: 'last-7d' }),
      now: NOW,
    });
    const widget = reportWidgets(bundle).find((w) => w.type === 'new-gaps')!;
    const table = widget.blocks[0] as any;
    expect(table.rows.map((r: any) => r.cells.gap)).toEqual(['POST /api/orders only succeeds']);
  });

  test('no project with the Test Map: the engineering report has no scenario gaps widget', async () => {
    const bundle = await collectReportBundle(db as any, {
      dashboard: 'engineering',
      scope: parseAnalyticsScope({ projects: '2' }),
      now: NOW,
    });
    expect(reportWidgets(bundle).some((w) => w.type === 'scenario-gaps')).toBe(false);
    expect(bundle.bands.some((b) => b.title === 'Scenario gaps')).toBe(false);
  });
});
