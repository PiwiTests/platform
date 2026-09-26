import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsMetricWidget } from '../../analytics/types';
import { metricBreakdowns, metricOptionsSchema, type MetricOptions } from '../../analytics/registry';
import { resolveCiCost } from '../ci-cost';
import { getAnalyticsContext, type AnalyticsContext, type ProjectAccess } from './common';
import type { CiCost } from '../../ci-cost';
import type { MetricId } from '../../analytics/metrics';
import { computeMetricSeries, computeMetricValues, hasMetricSeries, metricValue } from './metric-values';
import { computeMetricBreakdown, dimensionLabel } from './metric-breakdown';
import { evaluateTargets } from './targets';
import { targetDefForMetric, targetForPeriod } from '../../analytics/targets';

/**
 * One metric from the catalog over the period: its value and change, and for
 * the displays over time its series, with the comparison period's series
 * aligned bucket for bucket so it can be drawn as a faint line behind it.
 * With a breakdown, the metric is cut by a dimension: the top groups, then
 * *Other*. A display the metric cannot draw falls back to `stat`.
 */
export async function getAnalyticsMetric(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
  rawOptions: unknown = {},
): Promise<AnalyticsMetricWidget> {
  const options: MetricOptions = metricOptionsSchema.parse(rawOptions ?? {});
  const ctx = await getAnalyticsContext(db, scope, access);
  const { cost } = await resolveCiCost(db);
  const id = options.metric;
  const compare = options.comparison ? ctx.comparison : null;
  const from = ctx.period.from.getTime();
  const to = ctx.period.to.getTime();
  const breakdown =
    options.display !== 'stat' && options.breakdown && metricBreakdowns(id).includes(options.breakdown)
      ? options.breakdown
      : null;
  const hasSeries = hasMetricSeries(id);
  // Grouped, a bar or a table row per group needs no series; a line or heatmap per group does.
  let display: AnalyticsMetricWidget['display'] = options.display;
  if (display !== 'stat' && !hasSeries) display = breakdown ? (display === 'table' ? 'table' : 'bar') : 'stat';
  const overTime = hasSeries && display !== 'stat' && (!breakdown || display === 'line' || display === 'heatmap');
  const wholeSeries = overTime && !breakdown;

  const [current, previous, points, previousPoints, groups] = await Promise.all([
    computeMetricValues(db, ctx, [id], from, to, { cost }),
    compare
      ? computeMetricValues(db, ctx, [id], compare.from.getTime(), compare.to.getTime(), { cost })
      : Promise.resolve(null),
    wholeSeries ? computeMetricSeries(db, ctx, id, from, to, { cost }) : Promise.resolve(null),
    wholeSeries && compare
      ? computeMetricSeries(db, ctx, id, compare.from.getTime(), compare.to.getTime(), { cost })
      : Promise.resolve(null),
    breakdown
      ? computeMetricBreakdown(db, ctx, {
          metric: id,
          dimension: breakdown,
          from,
          to,
          compare: compare ? { from: compare.from.getTime(), to: compare.to.getTime() } : null,
          top: options.top,
          series: overTime,
          cost,
        })
      : Promise.resolve(null),
  ]);

  const series = points ?? [];
  return {
    target: options.target ? await metricTarget(db, ctx, id, cost) : null,
    display,
    value: metricValue(id, current.get(id) ?? null, previous?.get(id) ?? null, cost),
    bucketDays: ctx.buckets.bucketDays,
    points: series,
    // Aligned by position: bucket i of the comparison sits under bucket i of the period.
    previousPoints: previousPoints
      ? series.map((p, i) => ({ date: p.date, value: previousPoints[i]?.value ?? null }))
      : null,
    comparisonLabel: compare?.label ?? null,
    breakdown:
      breakdown && groups
        ? {
            dimension: breakdown,
            label: dimensionLabel(breakdown),
            groups: groups.map((g) => ({
              key: g.key,
              label: g.label,
              value: metricValue(id, g.value, g.previous, cost),
              points: g.points,
              other: g.other,
            })),
          }
        : null,
  };
}

/**
 * The target a metric widget draws: one project in scope setting a target on
 * the metric. A weekly target reads per bucket on the line, so it is scaled
 * to the bucket's length.
 */
async function metricTarget(
  db: DrizzleDB,
  ctx: AnalyticsContext,
  id: MetricId,
  cost: CiCost | null,
): Promise<AnalyticsMetricWidget['target']> {
  const def = targetDefForMetric(id);
  if (!def || ctx.allowed === 'all' || ctx.allowed.length !== 1) return null;
  const verdict = (await evaluateTargets(db, ctx, cost)).find((v) => v.metric === id);
  if (!verdict) return null;
  return {
    value: def.perWeek ? targetForPeriod(def, verdict.stored, ctx.buckets.bucketDays) : verdict.target,
    direction: verdict.direction,
    met: verdict.met,
  };
}
