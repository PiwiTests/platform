/**
 * Single source of truth for every cross-project analytics widget.
 *
 * Each entry describes one widget: a data handler in `shared/handlers/analytics`
 * (keyed by `id`), a page component, and a mapping to the document blocks of
 * a quality report (`shared/reports/widget-documents.ts`). Dashboards
 * (`shared/analytics/dashboards.ts`) place widgets in bands; the generic
 * `GET /api/analytics/[widget]` route dispatches by `id`. Adding a widget
 * means: one entry here, one handler file, one component, one document
 * mapping. No routing changes on either the server or the demo mirror.
 *
 * `band` is the widget's home band: the band of the Overview dashboard it
 * belongs to, and the group it is listed under when a widget is picked.
 */
import { z } from 'zod';
import { METRICS, type MetricId } from './metrics';

export type AnalyticsBandId = 'health' | 'pain' | 'trends' | 'detail';

export const ANALYTICS_BANDS: { id: AnalyticsBandId; label: string; description: string }[] = [
  { id: 'health', label: 'Where things stand', description: 'The state of every project right now.' },
  { id: 'pain', label: 'Where the pain is', description: 'What is costing you the most time and attention.' },
  { id: 'trends', label: 'Which way it is going', description: 'Movement over the selected period.' },
  { id: 'detail', label: 'Detail', description: 'Breakdowns to reach for once you know what you are chasing.' },
];

export interface AnalyticsWidgetMeta {
  id: string;
  /** Card title (sentence case). */
  title: string;
  /** Lucide icon for the card header. */
  icon: string;
  /** Layout hint: `full` spans the grid, `half` shares a row on wide screens. */
  size: 'full' | 'half';
  /** Which band the widget belongs to — decides where it renders. */
  band: AnalyticsBandId;
  /**
   * Whether the widget narrows to a test filter (a selection, test predicates,
   * browsers). One that cannot says so in its subtitle when a test filter is set.
   */
  testFilters: boolean;
  /** A widget that only makes sense for one project; unset for the cross-project widgets. */
  requires?: 'single-project';
  /**
   * The widget's options, checked and defaulted by this schema wherever a
   * dashboard places the widget. Unset: the widget takes no options.
   */
  options?: z.ZodType;
  /**
   * The capability the widget follows in each project of the scope: a project
   * that declined it is left out, and with none left the widget is not shown.
   */
  capability?: 'test-map';
}

/**
 * The metrics a widget can show: the catalog minus the Test Map metrics, which
 * the scenario-gaps widget reads.
 */
export const WIDGET_METRIC_IDS = METRICS.filter((m) => !('capability' in m)).map((m) => m.id) as [
  MetricId,
  ...MetricId[],
];

const metricIdSchema = z.enum(WIDGET_METRIC_IDS);

export const DEFAULT_STAT_METRICS: MetricId[] = [
  'test-pass-rate',
  'run-success-rate',
  'flaky-tests',
  'wasted-ci-minutes',
  'open-failure-causes',
  'median-time-to-fix',
];

export const statsOptionsSchema = z.object({
  metrics: z.array(metricIdSchema).min(1).max(8).default(DEFAULT_STAT_METRICS),
  /** A second metric shown under a tile, keyed by the tile's metric. */
  companions: z.partialRecord(metricIdSchema, metricIdSchema).default({}),
});

export const metricOptionsSchema = z.object({
  metric: metricIdSchema.default('test-pass-rate'),
  display: z.enum(['line', 'stat']).default('line'),
  /** Draw the comparison period as a faint line, and show the change. */
  comparison: z.boolean().default(true),
  /** Draw the period's timeline markers on the line. */
  markers: z.boolean().default(true),
});

export type StatsOptions = z.infer<typeof statsOptionsSchema>;
export type MetricOptions = z.infer<typeof metricOptionsSchema>;

export const ANALYTICS_WIDGETS = [
  {
    id: 'stats',
    title: 'Headline numbers',
    icon: 'i-lucide-gauge',
    size: 'full',
    band: 'health',
    testFilters: true,
    options: statsOptionsSchema,
  },
  {
    id: 'verdict',
    title: 'Verdict',
    icon: 'i-lucide-scale',
    size: 'full',
    band: 'health',
    testFilters: true,
  },
  {
    id: 'metric',
    title: 'Metric',
    icon: 'i-lucide-chart-spline',
    size: 'full',
    band: 'trends',
    testFilters: true,
    options: metricOptionsSchema,
  },
  {
    id: 'progress',
    title: 'What is being done',
    icon: 'i-lucide-list-checks',
    size: 'half',
    band: 'pain',
    testFilters: false,
  },
  {
    id: 'risks',
    title: 'Risks',
    icon: 'i-lucide-triangle-alert',
    size: 'half',
    band: 'pain',
    testFilters: false,
  },
  {
    id: 'portfolio',
    title: 'Portfolio health',
    icon: 'i-lucide-table-properties',
    size: 'full',
    band: 'health',
    testFilters: true,
  },
  {
    id: 'insights',
    title: 'Insights',
    icon: 'i-lucide-lightbulb',
    size: 'half',
    band: 'health',
    testFilters: true,
  },
  {
    id: 'pass-rate-heatmap',
    title: 'Pass rate heatmap',
    icon: 'i-lucide-grid-3x3',
    size: 'half',
    band: 'health',
    testFilters: true,
  },
  {
    id: 'cluster-landscape',
    title: 'Failure clusters',
    icon: 'i-lucide-layers',
    size: 'half',
    band: 'pain',
    testFilters: false,
  },
  {
    id: 'flaky-leaderboard',
    title: 'Flakiest tests',
    icon: 'i-lucide-repeat',
    size: 'half',
    band: 'pain',
    testFilters: true,
  },
  {
    id: 'wasted-time',
    title: 'Wasted CI time',
    icon: 'i-lucide-hourglass',
    size: 'half',
    band: 'pain',
    testFilters: true,
  },
  {
    id: 'regression-velocity',
    title: 'Regression velocity',
    icon: 'i-lucide-git-pull-request-arrow',
    size: 'half',
    band: 'trends',
    testFilters: true,
  },
  {
    id: 'ci-time-trend',
    title: 'CI time',
    icon: 'i-lucide-timer',
    size: 'half',
    band: 'trends',
    testFilters: true,
  },
  {
    id: 'browser-matrix',
    title: 'Browser matrix',
    icon: 'i-lucide-monitor-smartphone',
    size: 'half',
    band: 'detail',
    testFilters: true,
  },
  {
    id: 'slow-endpoints',
    title: 'Slow endpoints',
    icon: 'i-lucide-gauge',
    size: 'full',
    band: 'detail',
    testFilters: true,
  },
  {
    id: 'scenario-gaps',
    title: 'Scenario gaps',
    icon: 'i-lucide-map',
    size: 'full',
    band: 'detail',
    testFilters: false,
    capability: 'test-map',
  },
  {
    id: 'new-gaps',
    title: 'New scenario gaps',
    icon: 'i-lucide-map-pin-plus',
    size: 'full',
    band: 'detail',
    testFilters: false,
    capability: 'test-map',
  },
] as const satisfies readonly AnalyticsWidgetMeta[];

export type AnalyticsWidgetId = (typeof ANALYTICS_WIDGETS)[number]['id'];

const WIDGET_IDS = new Set<string>(ANALYTICS_WIDGETS.map((w) => w.id));

export function isAnalyticsWidgetId(value: unknown): value is AnalyticsWidgetId {
  return typeof value === 'string' && WIDGET_IDS.has(value);
}

const WIDGETS_BY_ID = new Map<string, AnalyticsWidgetMeta>(ANALYTICS_WIDGETS.map((w) => [w.id, w]));

export function getAnalyticsWidget(id: AnalyticsWidgetId): AnalyticsWidgetMeta {
  return WIDGETS_BY_ID.get(id)!;
}

export class WidgetOptionsError extends Error {}

/**
 * A widget's options, checked against its schema with the defaults filled in.
 * Throws `WidgetOptionsError` on options the schema refuses; a widget without
 * a schema takes none and gets `{}`.
 */
export function parseWidgetOptions(id: AnalyticsWidgetId, raw: unknown): Record<string, unknown> {
  const schema = getAnalyticsWidget(id).options;
  if (!schema) return {};
  const result = schema.safeParse(raw ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    throw new WidgetOptionsError(
      `Invalid options for ${id}: ${issue?.path.join('.') || 'options'} ${issue?.message ?? ''}`.trim(),
    );
  }
  return result.data as Record<string, unknown>;
}

/** Read the `options` query value (JSON) of a widget request; empty when absent. */
export function widgetOptionsFromQuery(raw: unknown): unknown {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string' || value.trim() === '') return {};
  try {
    return JSON.parse(value);
  } catch {
    throw new WidgetOptionsError('The options query value is not valid JSON');
  }
}
