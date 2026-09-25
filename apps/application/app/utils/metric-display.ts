/**
 * How the analytics widgets print a metric value: the shared report formatter
 * in English with the viewer's locale, so the page and the quality report read
 * the same numbers, and the one coloring rule for a change (better in the
 * passed color, worse in the failed color).
 */
import type { AnalyticsMetricValue } from '#shared/analytics/types';
import { makeFormatter, type ValueFormatter } from '#shared/reports/format';
import { STATUS_PALETTE } from './status-palette';
import { passRateTextClass } from './pass-rate';

export function metricFormatter(): ValueFormatter {
  return makeFormatter('en', viewerLocale());
}

export function formatMetric(value: AnalyticsMetricValue, f = metricFormatter()): string {
  return f.value(value.value, value.unit, value.precision, value.currency);
}

/** Text utility for a change: the passed color when it is good news, the failed color when bad. */
export function metricTrendClass(trend: AnalyticsMetricValue['trend']): string {
  if (trend === 'better') return STATUS_PALETTE.passed.text;
  if (trend === 'worse') return STATUS_PALETTE.failed.text;
  return 'text-muted';
}

/** Text utility for the value itself: the pass-rate scale for a pass rate, none otherwise. */
export function metricValueClass(value: AnalyticsMetricValue): string {
  return value.metric === 'test-pass-rate' || value.metric === 'run-success-rate' ? passRateTextClass(value.value) : '';
}
