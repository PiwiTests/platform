/**
 * Single source of truth for every cross-project analytics widget.
 *
 * Each entry describes one widget on the `/analytics` page. The generic
 * `GET /api/analytics/[widget]` route dispatches by `id` through the handler
 * map in `shared/handlers/analytics`, and the page maps the same `id` to a Vue
 * component — so adding a widget means: one entry here, one handler file, one
 * component. No routing changes on either the server or the demo mirror.
 *
 * Widgets are ordered into **bands**, not listed flat. Ten equally-weighted
 * cards asked the reader to work out for themselves which one to look at
 * first; the bands answer that — overall health, then where the pain is, then
 * how it's trending, then the detail you go to once you know what you're
 * looking for. Adding a widget means choosing its band, which is the useful
 * question to be forced to answer.
 */

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
}

export const ANALYTICS_WIDGETS = [
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
] as const satisfies readonly AnalyticsWidgetMeta[];

export type AnalyticsWidgetId = (typeof ANALYTICS_WIDGETS)[number]['id'];

const WIDGET_IDS = new Set<string>(ANALYTICS_WIDGETS.map((w) => w.id));

export function isAnalyticsWidgetId(value: unknown): value is AnalyticsWidgetId {
  return typeof value === 'string' && WIDGET_IDS.has(value);
}
