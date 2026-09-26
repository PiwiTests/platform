import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { MetricId } from '../../analytics/metrics';
import type { AnalyticsStats } from '../../analytics/types';
import { statsOptionsSchema, type StatsOptions } from '../../analytics/registry';
import { resolveCiCost } from '../ci-cost';
import { getAnalyticsContext, type ProjectAccess } from './common';
import { computeMetricValues, metricValue } from './metric-values';
import { evaluateTargets } from './targets';
import type { ProjectTargetVerdict } from '../../analytics/targets';
import type { AnalyticsTileTarget } from '../../analytics/types';

/** Wasted minutes always carry their cost as a companion when a cost is configured. */
const AUTOMATIC_COMPANIONS: Partial<Record<MetricId, MetricId>> = { 'wasted-ci-minutes': 'wasted-ci-cost' };

/**
 * A row of metric tiles: each metric's value over the period, its change
 * against the comparison period and, where set, a companion number.
 */
export async function getAnalyticsStats(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
  rawOptions: unknown = {},
): Promise<AnalyticsStats> {
  const options: StatsOptions = statsOptionsSchema.parse(rawOptions ?? {});
  const ctx = await getAnalyticsContext(db, scope, access);
  const { cost } = await resolveCiCost(db);
  const companions: Partial<Record<MetricId, MetricId>> = { ...AUTOMATIC_COMPANIONS, ...options.companions };
  const ids = [...options.metrics];
  for (const metric of options.metrics) {
    const companion = companions[metric];
    if (companion) ids.push(companion);
  }

  const [current, previous, targets] = await Promise.all([
    computeMetricValues(db, ctx, ids, ctx.period.from.getTime(), ctx.period.to.getTime(), { cost }),
    ctx.comparison
      ? computeMetricValues(db, ctx, ids, ctx.comparison.from.getTime(), ctx.comparison.to.getTime(), { cost })
      : Promise.resolve(null),
    evaluateTargets(db, ctx, cost),
  ]);

  const valueOf = (id: MetricId) => metricValue(id, current.get(id) ?? null, previous?.get(id) ?? null, cost);
  return {
    tiles: options.metrics.map((id) => {
      const companionId = companions[id];
      const companion = companionId ? valueOf(companionId) : null;
      return {
        ...valueOf(id),
        companion: companion && companion.value !== null ? companion : null,
        target: tileTarget(targets, id, ctx.allowed !== 'all' && ctx.allowed.length === 1),
      };
    }),
    comparisonLabel: ctx.comparison?.label ?? null,
  };
}

/** How the projects in scope stand against the metric's target; null when none sets one. */
export function tileTarget(
  verdicts: ProjectTargetVerdict[],
  metric: MetricId,
  singleProject: boolean,
): AnalyticsTileTarget | null {
  const mine = verdicts.filter((v) => v.metric === metric);
  if (mine.length === 0) return null;
  return {
    target: singleProject ? mine[0]!.target : null,
    direction: mine[0]!.direction,
    met: mine.filter((v) => v.met === true).length,
    missed: mine.filter((v) => v.met === false).length,
  };
}
