/**
 * The metric catalog's current values per project, in the OpenMetrics text
 * format, for a Prometheus or a Grafana the operator already runs: their
 * scraper pulls from Piwi, Piwi sends nothing anywhere. One gauge family per
 * catalog metric, one sample per project the caller can open, over the
 * scope's period (the last 7 days unless the query names one).
 */
import { inArray } from 'drizzle-orm';
import { projects } from '../../../server/database/schema';
import type { DrizzleDB } from '../db';
import { getMetric, type MetricDef, type MetricId } from '../../analytics/metrics';
import type { AnalyticsScope } from '../../analytics/scope';
import type { CiCost } from '../../ci-cost';
import { getAnalyticsContext, type ProjectAccess } from './common';
import { computeMetricValues, EVALUATED_METRIC_IDS } from './metric-values';

export const OPENMETRICS_CONTENT_TYPE = 'application/openmetrics-text; version=1.0.0; charset=utf-8';

export interface ProjectMetricSample {
  projectId: number;
  project: string;
  values: Map<MetricId, number | null>;
}

const UNIT_SUFFIX: Record<MetricDef['unit'], string | null> = {
  percent: 'percent',
  count: null,
  minutes: 'minutes',
  ms: 'milliseconds',
  days: 'days',
  money: null,
};

/** `test-pass-rate` → `piwi_test_pass_rate_percent`, with the unit the family declares. */
export function metricFamilyName(def: Pick<MetricDef, 'id' | 'unit'>): { name: string; unit: string | null } {
  const unit = UNIT_SUFFIX[def.unit];
  const base = `piwi_${def.id.replace(/-/g, '_')}`;
  return { name: unit ? `${base}_${unit}` : base, unit };
}

/** A label value: backslash, quote and line break escaped, as the format requires. */
export function escapeLabelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n');
}

function escapeHelp(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n');
}

function formatNumber(value: number): string {
  if (Number.isInteger(value)) return String(value);
  return String(Math.round(value * 1e6) / 1e6);
}

/** The exposition text: a family per metric, a sample per project with a value, then `# EOF`. */
export function renderOpenMetrics(
  samples: ProjectMetricSample[],
  opts: { ids: readonly MetricId[]; periodLabel: string; cost: CiCost | null },
): string {
  const lines: string[] = [];
  for (const id of opts.ids) {
    const def = getMetric(id);
    const { name, unit } = metricFamilyName(def);
    lines.push(`# TYPE ${name} gauge`);
    if (unit) lines.push(`# UNIT ${name} ${unit}`);
    lines.push(`# HELP ${name} ${escapeHelp(`${def.label}, ${opts.periodLabel}: ${def.definition}`)}`);
    for (const sample of samples) {
      const value = sample.values.get(id);
      if (value === null || value === undefined || !Number.isFinite(value)) continue;
      const labels = [`project="${escapeLabelValue(sample.project)}"`, `project_id="${sample.projectId}"`];
      if (def.unit === 'money' && opts.cost) labels.push(`currency="${escapeLabelValue(opts.cost.currency)}"`);
      lines.push(`${name}{${labels.join(',')}} ${formatNumber(value)}`);
    }
  }
  lines.push('# EOF');
  return `${lines.join('\n')}\n`;
}

/** The catalog's values per project the caller can open, over the scope's period. */
export async function collectProjectMetrics(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess,
  cost: CiCost | null,
): Promise<{ samples: ProjectMetricSample[]; ids: MetricId[]; periodLabel: string }> {
  const ids = EVALUATED_METRIC_IDS.filter((id) => id !== 'wasted-ci-cost' || cost !== null);
  const ctx = await getAnalyticsContext(db, scope, access);
  const periodLabel = ctx.period.label.toLowerCase();
  if (ctx.allowed !== 'all' && ctx.allowed.length === 0) return { samples: [], ids, periodLabel };
  const rows = await db
    .select({ id: projects.id, name: projects.name })
    .from(projects)
    .where(ctx.allowed === 'all' ? undefined : inArray(projects.id, ctx.allowed))
    .orderBy(projects.name);
  const samples: ProjectMetricSample[] = [];
  const from = ctx.period.from.getTime();
  const to = ctx.period.to.getTime();
  for (const row of rows) {
    const projectCtx = await getAnalyticsContext(db, { ...scope, projectIds: [row.id] }, access, ctx.now);
    const values = await computeMetricValues(db, projectCtx, ids, from, to, { cost });
    samples.push({ projectId: row.id, project: row.name, values });
  }
  return { samples, ids, periodLabel };
}
