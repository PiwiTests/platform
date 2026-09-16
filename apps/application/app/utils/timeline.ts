/**
 * Pure presentation helpers for the Workers timeline (colors, time formatting,
 * and SVG layout constants). Kept dependency-free so the timeline composables
 * and the presentational sub-components can all share one source of truth.
 */

/** Fixed pixel geometry for the timeline SVG. */
export const TIMELINE_LAYOUT = {
  barHeight: 24,
  rowGap: 8,
  labelWidth: 80,
  sidePadding: 16,
  axisHeight: 28,
  /** Height of a step bar inside an expanded sub-lane (shorter than a test bar). */
  stepBarHeight: 15,
  /** Derived: a full row is a bar plus the gap below it. */
  get rowHeight(): number {
    return this.barHeight + this.rowGap;
  },
} as const;

/**
 * Fill per reporter step category, used when a test row is expanded into its
 * step waterfall. Chosen to sit apart from the pass/fail status palette so a
 * step reads by what it did, not by an outcome; a failed step overrides to red.
 */
const STEP_CATEGORY_HEX: Record<string, string> = {
  action: '#2563eb',
  input: '#4f46e5',
  navigation: '#0891b2',
  assertion: '#7c3aed',
  wait: '#d97706',
  hook: '#64748b',
  fixture: '#94a3b8',
  setup: '#0d9488',
  api: '#c026d3',
  'test.step': '#475569',
  other: '#6b7280',
};

/** Fill for a step bar: its category color, or red when the step failed. */
export function timelineStepColor(category: string, failed: boolean): string {
  if (failed) return '#dc2626';
  return STEP_CATEGORY_HEX[category] ?? STEP_CATEGORY_HEX.other!;
}

const STATUS_HEX: Record<string, string> = {
  passed: '#16a34a',
  failed: '#dc2626',
  timedOut: '#ea580c',
  running: '#2563eb',
  initializing: '#2563eb',
  skipped: '#9ca3af',
  cancelled: '#a1a1aa',
  interrupted: '#ea580c',
  flaky: '#ca8a04',
};

/**
 * Amber palette for wasted-wait bars, shared by the bar renderer and the
 * tooltip swatch.
 */
export const TIMELINE_WAIT_COLORS = {
  fill: '#facc15',
  stroke: '#ca8a04',
  swatch: '#f59e0b',
} as const;

/**
 * Distinct colors for lock lanes/brackets, chosen to sit apart from the status
 * palette (green/red/orange/blue/gray/amber) so a lock never reads as a result.
 * Assigned by index in the run's sorted lock order and reused past the end.
 */
export const TIMELINE_LOCK_COLORS = [
  '#8b5cf6',
  '#0891b2',
  '#db2777',
  '#0d9488',
  '#c026d3',
  '#4f46e5',
  '#65a30d',
  '#e11d48',
] as const;

/** Color for the lock at `index` in the run's sorted lock order. */
export function lockColorHex(index: number): string {
  return TIMELINE_LOCK_COLORS[
    ((index % TIMELINE_LOCK_COLORS.length) + TIMELINE_LOCK_COLORS.length) % TIMELINE_LOCK_COLORS.length
  ]!;
}

/** Bar fill color for a test-case status (falls back to neutral gray). */
export function timelineStatusHex(status: string): string {
  return STATUS_HEX[status] || '#a1a1aa';
}

/** Fill for a hook/fixture bar: the status color at 40% alpha. */
export function timelineHookFill(status: string): string {
  return timelineStatusHex(status) + '66';
}

/** Stroke for a hook/fixture bar's dashed outline: the full status color. */
export function timelineHookStroke(status: string): string {
  return timelineStatusHex(status);
}

/** Human-readable duration used for timeline ticks, bar labels and tooltips. */
export function formatTimelineTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}
