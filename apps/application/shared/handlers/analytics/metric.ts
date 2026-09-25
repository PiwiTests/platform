import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsMetricWidget } from '../../analytics/types';
import { metricOptionsSchema, type MetricOptions } from '../../analytics/registry';
import { resolveCiCost } from '../ci-cost';
import { getAnalyticsContext, type ProjectAccess } from './common';
import { computeMetricSeries, computeMetricValues, hasMetricSeries, metricValue } from './metric-values';

/**
 * One metric from the catalog over the period: its value and change, and for
 * the line display its series, with the comparison period's series aligned
 * bucket for bucket so it can be drawn as a faint line behind it.
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
  const line = options.display === 'line' && hasMetricSeries(id);

  const [current, previous, points, previousPoints] = await Promise.all([
    computeMetricValues(db, ctx, [id], from, to, { cost }),
    compare
      ? computeMetricValues(db, ctx, [id], compare.from.getTime(), compare.to.getTime(), { cost })
      : Promise.resolve(null),
    line ? computeMetricSeries(db, ctx, id, from, to, { cost }) : Promise.resolve(null),
    line && compare
      ? computeMetricSeries(db, ctx, id, compare.from.getTime(), compare.to.getTime(), { cost })
      : Promise.resolve(null),
  ]);

  const series = points ?? [];
  return {
    display: line ? 'line' : 'stat',
    value: metricValue(id, current.get(id) ?? null, previous?.get(id) ?? null, cost),
    bucketDays: ctx.buckets.bucketDays,
    points: series,
    // Aligned by position: bucket i of the comparison sits under bucket i of the period.
    previousPoints: previousPoints
      ? series.map((p, i) => ({ date: p.date, value: previousPoints[i]?.value ?? null }))
      : null,
    comparisonLabel: compare?.label ?? null,
  };
}
