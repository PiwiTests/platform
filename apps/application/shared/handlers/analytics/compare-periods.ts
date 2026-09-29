import type { DrizzleDB } from '../db';
import { parsePeriod } from '../../analytics/period';
import type { AnalyticsScope } from '../../analytics/scope';
import type { MetricId } from '../../analytics/metrics';
import type { AnalyticsMetricValue } from '../../analytics/types';
import { DEFAULT_STAT_METRICS } from '../../analytics/registry';
import { resolveCiCost } from '../ci-cost';
import { getAnalyticsContext, type ProjectAccess } from './common';
import { computeMetricValues, metricValue } from './metric-values';

export interface PeriodComparison {
  a: { from: string; to: string; label: string };
  b: { from: string; to: string; label: string };
  /** Each metric over `a`, with `b` as its previous value: `delta` is a minus b. */
  tiles: AnalyticsMetricValue[];
}

export class PeriodSpecError extends Error {}

/**
 * The headline metrics of one scope over two periods chosen freely (`last-7d`
 * against `2026-08-01..2026-08-07`, this sprint against the last one): the
 * tile row with `b` as the comparison.
 */
export async function compareMetricPeriods(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess,
  a: string,
  b: string,
  metrics: MetricId[] = DEFAULT_STAT_METRICS,
): Promise<PeriodComparison> {
  const periodA = parsePeriod(a);
  const periodB = parsePeriod(b);
  if (!periodA) throw new PeriodSpecError(`Unreadable period a: '${a}'`);
  if (!periodB) throw new PeriodSpecError(`Unreadable period b: '${b}'`);
  const [ctxA, ctxB, { cost }] = await Promise.all([
    getAnalyticsContext(db, { ...scope, period: periodA, comparison: { kind: 'none' } }, access),
    getAnalyticsContext(db, { ...scope, period: periodB, comparison: { kind: 'none' } }, access),
    resolveCiCost(db),
  ]);
  const [valuesA, valuesB] = await Promise.all([
    computeMetricValues(db, ctxA, metrics, ctxA.period.from.getTime(), ctxA.period.to.getTime(), { cost }),
    computeMetricValues(db, ctxB, metrics, ctxB.period.from.getTime(), ctxB.period.to.getTime(), { cost }),
  ]);
  const summary = (p: { from: Date; to: Date; label: string }) => ({
    from: p.from.toISOString(),
    to: p.to.toISOString(),
    label: p.label,
  });
  return {
    a: summary(ctxA.period),
    b: summary(ctxB.period),
    tiles: metrics.map((id) => metricValue(id, valuesA.get(id) ?? null, valuesB.get(id) ?? null, cost)),
  };
}
