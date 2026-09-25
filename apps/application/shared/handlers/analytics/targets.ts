/**
 * Targets read over a period: each project of the scope that carries targets
 * gets one verdict per target, met or missed, from the metric values of that
 * project alone. The stat tiles, the portfolio, the insights, the metric
 * widget, the risks and the quality report read these verdicts.
 */
import { inArray } from 'drizzle-orm';
import { projects } from '../../../server/database/schema';
import type { DrizzleDB } from '../db';
import type { CiCost } from '../../ci-cost';
import {
  readProjectTargets,
  targetForPeriod,
  targetMet,
  TARGET_DEFS,
  type ProjectTargetVerdict,
} from '../../analytics/targets';
import { DAY_MS, type AnalyticsContext } from './common';
import { computeMetricValues } from './metric-values';

/** The context narrowed to one project: its runs, its clusters and its tests only. */
export function contextForProject(ctx: AnalyticsContext, projectId: number): AnalyticsContext {
  const testCaseIds = ctx.testFilter?.testCaseIds;
  return {
    ...ctx,
    allowed: [projectId],
    testFilter: ctx.testFilter
      ? {
          ...ctx.testFilter,
          testCaseIds: testCaseIds ? new Map([[projectId, testCaseIds.get(projectId) ?? new Set()]]) : null,
        }
      : null,
  };
}

/** Length of a period in days, at least one. */
export function periodDays(from: Date, to: Date): number {
  return Math.max(1, Math.round((to.getTime() - from.getTime()) / DAY_MS));
}

const cache = new WeakMap<AnalyticsContext, Promise<ProjectTargetVerdict[]>>();

/**
 * Every target of the projects in scope over the context's period, projects
 * without targets left out. Memoized per context, since several widgets of one
 * request read them.
 */
export function evaluateTargets(
  db: DrizzleDB,
  ctx: AnalyticsContext,
  cost: CiCost | null,
): Promise<ProjectTargetVerdict[]> {
  let pending = cache.get(ctx);
  if (!pending) {
    pending = computeTargets(db, ctx, cost);
    cache.set(ctx, pending);
  }
  return pending;
}

async function computeTargets(
  db: DrizzleDB,
  ctx: AnalyticsContext,
  cost: CiCost | null,
): Promise<ProjectTargetVerdict[]> {
  if (ctx.allowed !== 'all' && ctx.allowed.length === 0) return [];
  const rows: { id: number; name: string; label: string | null; targets: unknown }[] = await db
    .select({ id: projects.id, name: projects.name, label: projects.label, targets: projects.targets })
    .from(projects)
    .where(ctx.allowed === 'all' ? undefined : inArray(projects.id, ctx.allowed));

  const days = periodDays(ctx.period.from, ctx.period.to);
  const out: ProjectTargetVerdict[] = [];
  const sorted = [...rows].sort((a, b) => (a.label || a.name).localeCompare(b.label || b.name));
  for (const row of sorted) {
    const targets = readProjectTargets(row.targets);
    const defs = TARGET_DEFS.filter((d) => targets[d.key] !== undefined);
    if (defs.length === 0) continue;
    const values = await computeMetricValues(
      db,
      contextForProject(ctx, row.id),
      defs.map((d) => d.metric),
      ctx.period.from.getTime(),
      ctx.period.to.getTime(),
      { cost },
    );
    for (const def of defs) {
      const target = targetForPeriod(def, targets[def.key]!, days);
      const actual = values.get(def.metric) ?? null;
      out.push({
        projectId: row.id,
        projectName: row.label || row.name,
        key: def.key,
        metric: def.metric,
        direction: def.direction,
        stored: targets[def.key]!,
        target,
        actual,
        met: targetMet(def, target, actual),
      });
    }
  }
  return out;
}
