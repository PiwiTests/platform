/**
 * Report schedules and report snapshots: the saved recurring deliveries of a
 * quality report, and every quality report generated, stored with its frozen
 * bundle. Shared by the server routes, the `reports:schedule` task and the
 * demo; the parts that differ (whose project access a schedule runs with,
 * which channels exist) come in as arguments.
 *
 * Access: creating and editing a schedule needs the reporter or administrator
 * role (the routes declare it); a global schedule needs an administrator and
 * targets global channels only; a snapshot is readable by whoever can open
 * every project it covers.
 */
import { and, desc, eq, gte, inArray, isNotNull, lte } from 'drizzle-orm';
import { z } from 'zod';
import {
  notificationDeliveries,
  notificationChannels,
  projects,
  reportSchedules,
  reportSnapshots,
  testCases,
} from '../../server/database/schema';
import type { DrizzleDB } from './db';
import {
  analyticsScopeToQuery,
  DEFAULT_ANALYTICS_SCOPE,
  parseAnalyticsScope,
  type AnalyticsScope,
} from '../analytics/scope';
import {
  BUILTIN_DASHBOARDS,
  dashboardScope,
  getBuiltinDashboard,
  isBuiltinDashboardKey,
  type BuiltinDashboardKey,
} from '../analytics/dashboards';
import type { ComparisonSpec } from '../analytics/period';
import { collectReportBundle } from '../reports/collect';
import { makeFormatter, type ReportLanguage } from '../reports/format';
import { assertDashboardScope, ReportRequestError } from '../reports/request';
import { sentencesFor } from '../reports/sentences';
import type { ReportBundle } from '../reports/types';
import {
  lastCompletePeriod,
  latestDueRun,
  MONTHLY_ANCHOR_MAX,
  nextRunAt,
  normalizeScheduleTime,
  periodFor,
  REPORT_CADENCES,
  reportDedupeKey,
  SCHEDULE_COMPARISONS,
  type ReportCadence,
  type ScheduleComparison,
  type SchedulePeriod,
} from '../reports/schedule';
import { REPORT_READY_EVENT, type ReportReadyPayload } from '../notification-events';
import { getAnalyticsContext, type ProjectAccess } from './analytics/common';

export class ReportScheduleError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

/** Who is asking. With authentication off there is no user row: `id` is null and everything is global. */
export interface ReportActor {
  id: number | null;
  isAdmin: boolean;
  authEnabled: boolean;
}

/** A notification channel as a schedule sees it. */
export interface ReportChannel {
  id: number;
  name: string;
  type: string;
  userId: number | null;
}

// ── Input ────────────────────────────────────────────────────────────────────

const BUILTIN_KEYS = BUILTIN_DASHBOARDS.map((d) => d.key) as [BuiltinDashboardKey, ...BuiltinDashboardKey[]];

export const reportScheduleInputSchema = z.object({
  name: z.string().trim().min(1).max(120),
  dashboard: z.enum(BUILTIN_KEYS),
  /** The analytics scope keys (`projects`, `environments`, `allBranches`, `sel`, `owner`, …); the period is ignored. */
  scope: z.record(z.string(), z.string()).default({}),
  cadence: z.enum(REPORT_CADENCES),
  anchor: z.number().int().min(1).max(MONTHLY_ANCHOR_MAX).nullable().optional(),
  at: z.string().regex(/^([01]?\d|2[0-3]):[0-5]\d$/, 'at must be HH:mm'),
  comparison: z.enum(SCHEDULE_COMPARISONS).default('previous'),
  language: z.enum(['en', 'fr']).nullable().optional(),
  channelIds: z.array(z.number().int().positive()).min(1).max(20),
  /** Administrator only: an instance-wide schedule, sent to global channels. */
  global: z.boolean().optional(),
  active: z.boolean().optional(),
  /** Mute until this instant (ISO); null unmutes. */
  mutedUntil: z.string().datetime().nullable().optional(),
});

export const reportSchedulePatchSchema = reportScheduleInputSchema.partial();

export type ReportScheduleInput = z.infer<typeof reportScheduleInputSchema>;
export type ReportSchedulePatch = z.infer<typeof reportSchedulePatchSchema>;

/** Parse a request body, turning a zod refusal into a 400. */
export function parseScheduleBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body ?? {});
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new ReportScheduleError(400, `Invalid schedule: ${issue?.path.join('.') || 'body'} ${issue?.message ?? ''}`);
  }
  return parsed.data;
}

/** The filters a schedule keeps from a scope: its period comes from the cadence, its comparison from the schedule. */
export function scheduleFilters(query: Record<string, string>): Partial<AnalyticsScope> {
  const scope = parseAnalyticsScope(query);
  const keep: Partial<AnalyticsScope> = {
    defaultBranchOnly: scope.defaultBranchOnly,
    fullRunsOnly: scope.fullRunsOnly,
  };
  if (scope.projectIds) keep.projectIds = scope.projectIds;
  if (scope.projectTags) keep.projectTags = scope.projectTags;
  if (scope.environments) keep.environments = scope.environments;
  if (scope.branches) keep.branches = scope.branches;
  if (scope.selection) keep.selection = scope.selection;
  if (scope.tests) keep.tests = scope.tests;
  if (scope.browsers) keep.browsers = scope.browsers;
  return keep;
}

function anchorFor(cadence: ReportCadence, anchor: number | null | undefined): number | null {
  if (cadence === 'daily') return null;
  if (cadence === 'monthly') return Math.min(MONTHLY_ANCHOR_MAX, Math.max(1, anchor ?? 1));
  return Math.min(7, Math.max(1, anchor ?? 1));
}

// ── Views ────────────────────────────────────────────────────────────────────

type ScheduleRow = typeof reportSchedules.$inferSelect;

export interface ReportScheduleView {
  id: number;
  name: string;
  /** Instance-wide, managed by administrators. */
  global: boolean;
  ownerId: number | null;
  dashboard: BuiltinDashboardKey;
  dashboardName: string;
  /** The scope query keys of the schedule's filters, as the analytics page reads them. */
  scope: Record<string, string>;
  cadence: ReportCadence;
  anchor: number | null;
  at: string;
  comparison: ScheduleComparison;
  language: ReportLanguage | null;
  channels: Array<{ id: number; name: string; type: string }>;
  active: boolean;
  mutedUntil: string | null;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Whether the reader may edit, run or delete it. */
  canEdit: boolean;
}

const iso = (value: Date | number | null | undefined) => (value == null ? null : new Date(value).toISOString());

function filtersQuery(filters: Partial<AnalyticsScope> | null): Record<string, string> {
  const query = analyticsScopeToQuery({ ...DEFAULT_ANALYTICS_SCOPE, ...filters });
  delete query.period;
  return query;
}

function canEdit(row: Pick<ScheduleRow, 'userId'>, actor: ReportActor): boolean {
  if (actor.isAdmin) return true;
  return row.userId !== null && row.userId === actor.id;
}

function toView(row: ScheduleRow, channels: ReportChannel[], actor: ReportActor): ReportScheduleView {
  const dashboard = isBuiltinDashboardKey(row.builtinDashboard) ? row.builtinDashboard : 'executive';
  const ids = (row.channelIds as number[] | null) ?? [];
  const byId = new Map(channels.map((c) => [c.id, c]));
  return {
    id: row.id,
    name: row.name,
    global: row.userId === null,
    ownerId: row.userId,
    dashboard,
    dashboardName: getBuiltinDashboard(dashboard).name,
    scope: filtersQuery(row.scope as Partial<AnalyticsScope> | null),
    cadence: row.cadence as ReportCadence,
    anchor: row.anchor ?? null,
    at: row.at,
    comparison: row.comparison as ScheduleComparison,
    language: (row.language as ReportLanguage | null) ?? null,
    channels: ids.map((id) => {
      const c = byId.get(id);
      return { id, name: c?.name ?? `Channel #${id}`, type: c?.type ?? 'unknown' };
    }),
    active: row.active,
    mutedUntil: iso(row.mutedUntil),
    lastRunAt: iso(row.lastRunAt),
    nextRunAt: iso(row.nextRunAt),
    createdAt: iso(row.createdAt)!,
    updatedAt: iso(row.updatedAt)!,
    canEdit: canEdit(row, actor),
  };
}

// ── Schedules ────────────────────────────────────────────────────────────────

/** Every channel, for naming a schedule's destinations. */
export async function loadReportChannels(db: DrizzleDB): Promise<ReportChannel[]> {
  return db
    .select({
      id: notificationChannels.id,
      name: notificationChannels.name,
      type: notificationChannels.type,
      userId: notificationChannels.userId,
    })
    .from(notificationChannels);
}

/**
 * The schedules a reader sees: administrators (and everyone with
 * authentication off) see them all; anyone else their own and the global ones.
 */
export async function listReportSchedules(
  db: DrizzleDB,
  actor: ReportActor,
  channels: ReportChannel[],
): Promise<ReportScheduleView[]> {
  const rows = await db.select().from(reportSchedules).orderBy(desc(reportSchedules.createdAt));
  const visible =
    actor.isAdmin || !actor.authEnabled ? rows : rows.filter((r) => r.userId === null || r.userId === actor.id);
  return visible.map((r) => toView(r, channels, actor));
}

async function loadSchedule(db: DrizzleDB, id: number): Promise<ScheduleRow> {
  const [row] = await db.select().from(reportSchedules).where(eq(reportSchedules.id, id));
  if (!row) throw new ReportScheduleError(404, 'Report schedule not found');
  return row;
}

/** One schedule, when the reader may see it. */
export async function getReportSchedule(
  db: DrizzleDB,
  id: number,
  actor: ReportActor,
  channels: ReportChannel[],
): Promise<ReportScheduleView> {
  const row = await loadSchedule(db, id);
  const visible = actor.isAdmin || !actor.authEnabled || row.userId === null || row.userId === actor.id;
  if (!visible) throw new ReportScheduleError(404, 'Report schedule not found');
  return toView(row, channels, actor);
}

async function editableSchedule(db: DrizzleDB, id: number, actor: ReportActor): Promise<ScheduleRow> {
  const row = await loadSchedule(db, id);
  if (!canEdit(row, actor)) {
    if (row.userId !== null && row.userId !== actor.id && !actor.isAdmin) {
      throw new ReportScheduleError(404, 'Report schedule not found');
    }
    throw new ReportScheduleError(403, 'Only administrators can change a global schedule');
  }
  return row;
}

export interface ScheduleWriteContext {
  actor: ReportActor;
  channels: ReportChannel[];
  /** The actor's project access, checked against the schedule's project filter. */
  access: ProjectAccess;
  /** The zone schedules run in (`scheduleTimeZone`). */
  timeZone: string;
  now?: number;
}

function checkSchedule(
  values: {
    dashboard: BuiltinDashboardKey;
    filters: Partial<AnalyticsScope>;
    channelIds: number[];
    global: boolean;
  },
  ctx: ScheduleWriteContext,
): void {
  try {
    assertDashboardScope(values.dashboard, {
      ...dashboardScope(getBuiltinDashboard(values.dashboard).definition),
      ...values.filters,
    });
  } catch (error) {
    if (error instanceof ReportRequestError) throw new ReportScheduleError(400, error.message);
    throw error;
  }
  if (values.global && ctx.actor.authEnabled && !ctx.actor.isAdmin) {
    throw new ReportScheduleError(403, 'Only administrators can create global schedules');
  }
  const byId = new Map(ctx.channels.map((c) => [c.id, c]));
  for (const id of values.channelIds) {
    const channel = byId.get(id);
    if (!channel) throw new ReportScheduleError(404, `Channel #${id} not found`);
    // A global schedule delivers without a per-user access check, so a personal
    // channel would carry every project's numbers to its owner.
    if (values.global && channel.userId !== null) {
      throw new ReportScheduleError(400, 'Global schedules require global channels');
    }
    if (!values.global && channel.userId !== null && channel.userId !== ctx.actor.id && !ctx.actor.isAdmin) {
      throw new ReportScheduleError(403, "Cannot send to another user's channel");
    }
  }
  const projectIds = values.filters.projectIds ?? [];
  if (ctx.access !== 'all' && projectIds.some((id) => !(ctx.access as Set<number>).has(id))) {
    throw new ReportScheduleError(403, 'No access to a project of this schedule');
  }
}

/** Create a schedule; it first fires at its next scheduled instant. */
export async function createReportSchedule(
  db: DrizzleDB,
  input: ReportScheduleInput,
  ctx: ScheduleWriteContext,
): Promise<ReportScheduleView> {
  const now = ctx.now ?? Date.now();
  const global = input.global === true || !ctx.actor.authEnabled;
  const filters = scheduleFilters(input.scope);
  checkSchedule({ dashboard: input.dashboard, filters, channelIds: input.channelIds, global }, ctx);
  const anchor = anchorFor(input.cadence, input.anchor);
  const at = normalizeScheduleTime(input.at);
  const createdAt = new Date(now);
  const [row] = await db
    .insert(reportSchedules)
    .values({
      name: input.name,
      userId: global ? null : ctx.actor.id,
      scope: filters,
      builtinDashboard: input.dashboard,
      cadence: input.cadence,
      anchor,
      at,
      comparison: input.comparison,
      language: input.language ?? null,
      channelIds: [...new Set(input.channelIds)],
      active: input.active ?? true,
      mutedUntil: input.mutedUntil ? new Date(input.mutedUntil) : null,
      nextRunAt: nextRunAt({ cadence: input.cadence, anchor, at, createdAt }, now, ctx.timeZone),
      createdAt,
      updatedAt: createdAt,
    })
    .returning();
  return toView(row!, ctx.channels, ctx.actor);
}

/** Change a schedule; a new cadence, anchor or time moves its next firing. */
export async function updateReportSchedule(
  db: DrizzleDB,
  id: number,
  patch: ReportSchedulePatch,
  ctx: ScheduleWriteContext,
): Promise<ReportScheduleView> {
  const now = ctx.now ?? Date.now();
  const row = await editableSchedule(db, id, ctx.actor);
  const global = patch.global !== undefined ? patch.global || !ctx.actor.authEnabled : row.userId === null;
  const dashboard =
    patch.dashboard ?? (isBuiltinDashboardKey(row.builtinDashboard) ? row.builtinDashboard : 'executive');
  const filters = patch.scope ? scheduleFilters(patch.scope) : ((row.scope as Partial<AnalyticsScope> | null) ?? {});
  const channelIds = patch.channelIds ? [...new Set(patch.channelIds)] : ((row.channelIds as number[] | null) ?? []);
  checkSchedule({ dashboard, filters, channelIds, global }, ctx);

  const cadence = patch.cadence ?? (row.cadence as ReportCadence);
  const anchor = anchorFor(cadence, patch.anchor !== undefined ? patch.anchor : row.anchor);
  const at = patch.at ? normalizeScheduleTime(patch.at) : row.at;
  const timingChanged = cadence !== row.cadence || anchor !== row.anchor || at !== row.at;
  const reactivated = patch.active === true && !row.active;
  const next =
    timingChanged || reactivated || !row.nextRunAt
      ? nextRunAt({ cadence, anchor, at, createdAt: row.createdAt }, now, ctx.timeZone)
      : row.nextRunAt;

  const [updated] = await db
    .update(reportSchedules)
    .set({
      name: patch.name ?? row.name,
      userId: global ? null : (row.userId ?? ctx.actor.id),
      scope: filters,
      builtinDashboard: dashboard,
      cadence,
      anchor,
      at,
      comparison: patch.comparison ?? row.comparison,
      language: patch.language !== undefined ? patch.language : row.language,
      channelIds,
      active: patch.active ?? row.active,
      mutedUntil:
        patch.mutedUntil !== undefined ? (patch.mutedUntil ? new Date(patch.mutedUntil) : null) : row.mutedUntil,
      nextRunAt: next,
      updatedAt: new Date(now),
    })
    .where(eq(reportSchedules.id, id))
    .returning();
  return toView(updated!, ctx.channels, ctx.actor);
}

/** Delete a schedule; its snapshots stay, as reports generated by hand. */
export async function deleteReportSchedule(db: DrizzleDB, id: number, actor: ReportActor): Promise<void> {
  await editableSchedule(db, id, actor);
  await db.delete(reportSchedules).where(eq(reportSchedules.id, id));
}

// ── Running a schedule ───────────────────────────────────────────────────────

export interface GenerateContext {
  /** The project access the report is collected with: the schedule owner's at run time. */
  access: ProjectAccess;
  timeZone: string;
  baseUrl?: string | null;
  piwiVersion?: string | null;
  /** Queue one outbox row per channel; the demo has no outbox. */
  deliver: boolean;
  now?: number;
}

export interface ScheduleRunResult {
  snapshotId: number;
  period: SchedulePeriod;
  /** Outbox rows queued (0 when muted or not delivering). */
  queued: number;
  muted: boolean;
}

const COMPARISONS: Record<ScheduleComparison, ComparisonSpec> = {
  previous: { kind: 'previous' },
  'year-ago': { kind: 'year' },
  none: { kind: 'none' },
};

/** The ids of the projects a bundle covers: the scope resolved against the access it was collected with. */
async function coveredProjects(db: DrizzleDB, scope: AnalyticsScope, access: ProjectAccess): Promise<number[]> {
  const ctx = await getAnalyticsContext(db, scope, access);
  if (ctx.allowed !== 'all') return [...ctx.allowed].sort((a, b) => a - b);
  const rows = await db.select({ id: projects.id }).from(projects);
  return rows.map((r) => r.id).sort((a, b) => a - b);
}

async function storeSnapshot(
  db: DrizzleDB,
  values: {
    bundle: ReportBundle;
    scope: AnalyticsScope;
    projectIds: number[];
    scheduleId: number | null;
    createdBy: number | null;
  },
): Promise<number> {
  const { bundle } = values;
  const json = JSON.stringify(bundle);
  const [row] = await db
    .insert(reportSnapshots)
    .values({
      scheduleId: values.scheduleId,
      createdBy: values.createdBy,
      dashboardRef: bundle.dashboard.ref,
      dashboardName: bundle.dashboard.name,
      scope: values.scope,
      projectIds: values.projectIds,
      periodFrom: new Date(bundle.period.from),
      periodTo: new Date(bundle.period.to),
      comparisonFrom: bundle.comparison ? new Date(bundle.comparison.from) : null,
      comparisonTo: bundle.comparison ? new Date(bundle.comparison.to) : null,
      bundle,
      sizeBytes: new TextEncoder().encode(json).length,
      generatedAt: new Date(bundle.generatedAt),
    })
    .returning({ id: reportSnapshots.id });
  return row!.id;
}

/**
 * Render one firing of a schedule into a snapshot, and queue its deliveries.
 * A scheduled firing (`runAt`) reports on the period that firing covers; *Run
 * now* (`runAt` omitted) on the last complete cadence. A muted schedule keeps
 * its snapshot and sends nothing.
 */
export async function runReportSchedule(
  db: DrizzleDB,
  schedule: ScheduleRow,
  ctx: GenerateContext & { runAt?: number; createdBy?: number | null },
): Promise<ScheduleRunResult> {
  const now = ctx.now ?? Date.now();
  const timing = {
    cadence: schedule.cadence as ReportCadence,
    anchor: schedule.anchor,
    at: schedule.at,
    createdAt: schedule.createdAt,
  };
  const manual = ctx.runAt === undefined;
  const period = manual ? lastCompletePeriod(timing, now, ctx.timeZone) : periodFor(timing, ctx.runAt!, ctx.timeZone);
  const dashboard = isBuiltinDashboardKey(schedule.builtinDashboard) ? schedule.builtinDashboard : 'executive';
  const scope: AnalyticsScope = {
    ...dashboardScope(getBuiltinDashboard(dashboard).definition),
    ...((schedule.scope as Partial<AnalyticsScope> | null) ?? {}),
    period: { kind: 'range', from: period.from, to: period.to },
    comparison: COMPARISONS[schedule.comparison as ScheduleComparison] ?? { kind: 'previous' },
    granularity: 'auto',
    timeZone: ctx.timeZone,
  };
  const bundle = await collectReportBundle(db, {
    dashboard,
    scope,
    access: ctx.access,
    language: (schedule.language as ReportLanguage | null) ?? undefined,
    timeZone: ctx.timeZone,
    baseUrl: ctx.baseUrl ?? null,
    piwiVersion: ctx.piwiVersion ?? null,
    now,
  });
  bundle.title = `${schedule.name}: ${bundle.title}`;
  if (period.firstRun) {
    const f = makeFormatter(bundle.language, bundle.locale);
    bundle.limits.unshift(sentencesFor(bundle.language).firstRunLimit(f.date(period.from)));
  }
  const snapshotId = await storeSnapshot(db, {
    bundle,
    scope,
    projectIds: await coveredProjects(db, scope, ctx.access),
    scheduleId: schedule.id,
    createdBy: ctx.createdBy ?? null,
  });
  if (bundle.sourceUrl && ctx.baseUrl) {
    bundle.sourceUrl = `${ctx.baseUrl.replace(/\/$/, '')}/reports/${snapshotId}`;
    await db.update(reportSnapshots).set({ bundle }).where(eq(reportSnapshots.id, snapshotId));
  }

  const muted = !!schedule.mutedUntil && new Date(schedule.mutedUntil).getTime() > now;
  let queued = 0;
  if (ctx.deliver && !muted) {
    const wanted = (schedule.channelIds as number[] | null) ?? [];
    const existing =
      wanted.length > 0
        ? await db
            .select({ id: notificationChannels.id })
            .from(notificationChannels)
            .where(inArray(notificationChannels.id, wanted))
        : [];
    const payload: ReportReadyPayload = { snapshotId, scheduleId: schedule.id, periodEnd: period.to };
    for (const { id: channelId } of existing) {
      const inserted = await db
        .insert(notificationDeliveries)
        .values({
          subscriptionId: null,
          channelId,
          event: REPORT_READY_EVENT,
          payload,
          dedupeKey: reportDedupeKey(schedule.id, period.to, channelId, manual ? snapshotId : undefined),
          status: 'pending',
          scheduledFor: new Date(now),
        })
        .onConflictDoNothing()
        .returning({ id: notificationDeliveries.id });
      queued += inserted.length;
    }
  }
  await db
    .update(reportSchedules)
    .set({ lastRunAt: new Date(now) })
    .where(eq(reportSchedules.id, schedule.id));
  return { snapshotId, period, queued, muted };
}

/** *Run now*: generate a schedule's quality report over its last complete cadence and deliver it. */
export async function runReportScheduleNow(
  db: DrizzleDB,
  id: number,
  actor: ReportActor,
  ctx: GenerateContext,
): Promise<ScheduleRunResult> {
  const row = await editableSchedule(db, id, actor);
  return runReportSchedule(db, row, { ...ctx, createdBy: actor.id });
}

/**
 * The `reports:schedule` sweep: every active schedule whose next firing is
 * due fires once, for its intended period (the latest one when the server
 * missed several), then moves to its next firing. `accessFor` resolves a
 * schedule owner's project access at run time (a global schedule, owner null,
 * sees every project).
 */
export async function sweepReportSchedules(
  db: DrizzleDB,
  ctx: Omit<GenerateContext, 'access'> & { accessFor: (userId: number | null) => Promise<ProjectAccess> },
): Promise<{ fired: number; failed: number }> {
  const now = ctx.now ?? Date.now();
  const due = await db
    .select()
    .from(reportSchedules)
    .where(
      and(
        eq(reportSchedules.active, true),
        isNotNull(reportSchedules.nextRunAt),
        lte(reportSchedules.nextRunAt, new Date(now)),
      ),
    );
  let fired = 0;
  let failed = 0;
  for (const schedule of due) {
    const timing = {
      cadence: schedule.cadence as ReportCadence,
      anchor: schedule.anchor,
      at: schedule.at,
      createdAt: schedule.createdAt,
    };
    const runAt = latestDueRun(timing, new Date(schedule.nextRunAt!).getTime(), now, ctx.timeZone);
    // Advance first, so a failing schedule is retried at its next firing rather than every sweep.
    await db
      .update(reportSchedules)
      .set({ nextRunAt: nextRunAt(timing, runAt.getTime(), ctx.timeZone) })
      .where(eq(reportSchedules.id, schedule.id));
    try {
      const access = await ctx.accessFor(schedule.userId);
      await runReportSchedule(db, schedule, { ...ctx, access, runAt: runAt.getTime(), now });
      fired++;
    } catch (error) {
      failed++;
      console.error(`[reports] Schedule ${schedule.id} failed:`, error instanceof Error ? error.message : error);
    }
  }
  return { fired, failed };
}

/** Move every schedule's next firing onto the current time zone, when the instance zone changes. */
export async function rescheduleReportSchedules(db: DrizzleDB, timeZone: string, now = Date.now()): Promise<void> {
  const rows = await db.select().from(reportSchedules).where(eq(reportSchedules.active, true));
  for (const row of rows) {
    const next = nextRunAt(
      { cadence: row.cadence as ReportCadence, anchor: row.anchor, at: row.at, createdAt: row.createdAt },
      now,
      timeZone,
    );
    await db.update(reportSchedules).set({ nextRunAt: next }).where(eq(reportSchedules.id, row.id));
  }
}

// ── Snapshots ────────────────────────────────────────────────────────────────

/** Generate a quality report by hand and keep it as a snapshot. */
export async function createReportSnapshot(
  db: DrizzleDB,
  request: { dashboard: BuiltinDashboardKey; scope: AnalyticsScope; language?: ReportLanguage },
  ctx: Omit<GenerateContext, 'deliver'> & { createdBy: number | null },
): Promise<{ id: number }> {
  const bundle = await collectReportBundle(db, {
    dashboard: request.dashboard,
    scope: request.scope,
    access: ctx.access,
    language: request.language,
    locale: request.scope.locale,
    timeZone: request.scope.timeZone ?? ctx.timeZone,
    baseUrl: ctx.baseUrl ?? null,
    piwiVersion: ctx.piwiVersion ?? null,
    now: ctx.now,
  });
  const id = await storeSnapshot(db, {
    bundle,
    scope: request.scope,
    projectIds: await coveredProjects(db, request.scope, ctx.access),
    scheduleId: null,
    createdBy: ctx.createdBy,
  });
  return { id };
}

export interface ReportDeliveryView {
  channelId: number;
  channelName: string;
  channelType: string;
  status: string;
  error: string | null;
  sentAt: string | null;
}

export interface ReportSnapshotSummary {
  id: number;
  title: string;
  scheduleId: number | null;
  scheduleName: string | null;
  dashboardRef: string;
  dashboardName: string;
  scopeText: ReportBundle['scopeText'];
  period: ReportBundle['period'];
  verdict: ReportBundle['verdict'];
  generatedAt: string;
  sizeBytes: number;
  deliveries: ReportDeliveryView[];
}

export interface ReportSnapshotView extends ReportSnapshotSummary {
  bundle: ReportBundle;
}

/** A snapshot is readable when the reader can open every project it covers. */
export function canReadSnapshot(projectIds: unknown, access: ProjectAccess): boolean {
  if (access === 'all') return true;
  const ids = Array.isArray(projectIds) ? (projectIds as number[]) : [];
  return ids.every((id) => access.has(id));
}

const SNAPSHOT_SCAN = 200;

async function deliveriesFor(
  db: DrizzleDB,
  snapshotIds: number[],
  since: Date,
): Promise<Map<number, ReportDeliveryView[]>> {
  const out = new Map<number, ReportDeliveryView[]>();
  if (snapshotIds.length === 0) return out;
  const wanted = new Set(snapshotIds);
  const rows = await db
    .select({ d: notificationDeliveries, name: notificationChannels.name, type: notificationChannels.type })
    .from(notificationDeliveries)
    .innerJoin(notificationChannels, eq(notificationDeliveries.channelId, notificationChannels.id))
    .where(and(eq(notificationDeliveries.event, REPORT_READY_EVENT), gte(notificationDeliveries.createdAt, since)));
  for (const { d, name, type } of rows) {
    const snapshotId = (d.payload as ReportReadyPayload | null)?.snapshotId;
    if (!snapshotId || !wanted.has(snapshotId)) continue;
    const list = out.get(snapshotId) ?? [];
    list.push({
      channelId: d.channelId,
      channelName: name,
      channelType: type,
      status: d.status,
      error: d.error ?? null,
      sentAt: iso(d.sentAt),
    });
    out.set(snapshotId, list);
  }
  return out;
}

function summaryOf(
  row: typeof reportSnapshots.$inferSelect,
  scheduleName: string | null,
  deliveries: ReportDeliveryView[],
): ReportSnapshotView {
  const bundle = row.bundle as ReportBundle;
  return {
    id: row.id,
    title: bundle.title,
    scheduleId: row.scheduleId ?? null,
    scheduleName,
    dashboardRef: row.dashboardRef,
    dashboardName: row.dashboardName,
    scopeText: bundle.scopeText,
    period: bundle.period,
    verdict: bundle.verdict,
    generatedAt: iso(row.generatedAt)!,
    sizeBytes: row.sizeBytes,
    deliveries,
    bundle,
  };
}

/** The snapshots a reader can open, newest first, with how each was delivered. */
export async function listReportSnapshots(
  db: DrizzleDB,
  access: ProjectAccess,
  opts: { limit?: number; scheduleId?: number } = {},
): Promise<ReportSnapshotSummary[]> {
  const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
  const rows = await db
    .select({ s: reportSnapshots, scheduleName: reportSchedules.name })
    .from(reportSnapshots)
    .leftJoin(reportSchedules, eq(reportSnapshots.scheduleId, reportSchedules.id))
    .where(opts.scheduleId ? eq(reportSnapshots.scheduleId, opts.scheduleId) : undefined)
    .orderBy(desc(reportSnapshots.generatedAt), desc(reportSnapshots.id))
    .limit(SNAPSHOT_SCAN);
  const readable = rows.filter((r) => canReadSnapshot(r.s.projectIds, access)).slice(0, limit);
  if (readable.length === 0) return [];
  const oldest = readable[readable.length - 1]!.s.generatedAt;
  const deliveries = await deliveriesFor(
    db,
    readable.map((r) => r.s.id),
    new Date(new Date(oldest).getTime() - 60_000),
  );
  return readable.map((r) => {
    const { bundle: _bundle, ...summary } = summaryOf(r.s, r.scheduleName ?? null, deliveries.get(r.s.id) ?? []);
    return summary;
  });
}

/** One snapshot with its bundle; 404 when missing, 403 when it covers a project the reader cannot open. */
export async function getReportSnapshot(db: DrizzleDB, id: number, access: ProjectAccess): Promise<ReportSnapshotView> {
  const [row] = await db
    .select({ s: reportSnapshots, scheduleName: reportSchedules.name })
    .from(reportSnapshots)
    .leftJoin(reportSchedules, eq(reportSnapshots.scheduleId, reportSchedules.id))
    .where(eq(reportSnapshots.id, id));
  if (!row) throw new ReportScheduleError(404, 'Report snapshot not found');
  if (!canReadSnapshot(row.s.projectIds, access)) {
    throw new ReportScheduleError(403, 'This quality report covers a project you cannot open');
  }
  const deliveries = await deliveriesFor(db, [id], new Date(new Date(row.s.generatedAt).getTime() - 60_000));
  return summaryOf(row.s, row.scheduleName ?? null, deliveries.get(id) ?? []);
}

/** A snapshot's bundle and projects for a delivery, with no access check (the schedule's access applied at generation). */
export async function loadSnapshotForDelivery(
  db: DrizzleDB,
  id: number,
): Promise<{ bundle: ReportBundle; projectIds: number[] } | null> {
  const [row] = await db
    .select({ bundle: reportSnapshots.bundle, projectIds: reportSnapshots.projectIds })
    .from(reportSnapshots)
    .where(eq(reportSnapshots.id, id));
  if (!row) return null;
  return { bundle: row.bundle as ReportBundle, projectIds: (row.projectIds as number[] | null) ?? [] };
}

/** The owners the tests of the reader's projects carry, for the team dashboard's owner filter. */
export async function listScheduleOwners(
  db: DrizzleDB,
  access: ProjectAccess,
): Promise<Array<{ owner: string; projectIds: number[] }>> {
  if (access !== 'all' && access.size === 0) return [];
  const rows = await db
    .selectDistinct({ owner: testCases.owner, projectId: testCases.projectId })
    .from(testCases)
    .where(and(isNotNull(testCases.owner), access === 'all' ? undefined : inArray(testCases.projectId, [...access])))
    .limit(2000);
  const byOwner = new Map<string, Set<number>>();
  for (const r of rows) {
    const owner = r.owner?.trim();
    if (!owner) continue;
    const set = byOwner.get(owner) ?? new Set<number>();
    set.add(r.projectId);
    byOwner.set(owner, set);
  }
  return [...byOwner.entries()]
    .map(([owner, ids]) => ({ owner, projectIds: [...ids].sort((a, b) => a - b) }))
    .sort((a, b) => a.owner.localeCompare(b.owner));
}
