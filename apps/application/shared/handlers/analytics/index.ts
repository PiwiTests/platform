import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import { isAnalyticsWidgetId, parseWidgetOptions, type AnalyticsWidgetId } from '../../analytics/registry';
import type { ProjectAccess } from './common';
import { getAnalyticsPortfolio } from './portfolio';
import { getAnalyticsPassRateHeatmap } from './pass-rate-heatmap';
import { getAnalyticsCiTimeTrend } from './ci-time-trend';
import { getAnalyticsWastedTime } from './wasted-time';
import { getAnalyticsFlakyLeaderboard } from './flaky-leaderboard';
import { getAnalyticsClusterLandscape } from './cluster-landscape';
import { getAnalyticsRegressionVelocity } from './regression-velocity';
import { getAnalyticsBrowserMatrix } from './browser-matrix';
import { getAnalyticsSlowEndpoints } from './slow-endpoints';
import { getAnalyticsInsights } from './insights';
import { getAnalyticsStats } from './stats';
import { getAnalyticsMetric } from './metric';
import { getAnalyticsVerdict } from './verdict';
import { getAnalyticsProgress } from './progress';
import { getAnalyticsRisks } from './risks';
import { getAnalyticsNewGaps, getAnalyticsScenarioGaps } from './scenario-gaps';

export { isAnalyticsWidgetId };
export type { AnalyticsWidgetId, ProjectAccess };

type AnalyticsWidgetHandler = (
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess,
  options: Record<string, unknown>,
) => Promise<unknown>;

/**
 * Widget id → handler. Keyed by the registry union, so forgetting a handler
 * for a registered widget (or vice versa) is a compile error.
 */
const ANALYTICS_WIDGET_HANDLERS: Record<AnalyticsWidgetId, AnalyticsWidgetHandler> = {
  stats: getAnalyticsStats,
  metric: getAnalyticsMetric,
  verdict: getAnalyticsVerdict,
  progress: getAnalyticsProgress,
  risks: getAnalyticsRisks,
  insights: getAnalyticsInsights,
  portfolio: getAnalyticsPortfolio,
  'pass-rate-heatmap': getAnalyticsPassRateHeatmap,
  'ci-time-trend': getAnalyticsCiTimeTrend,
  'wasted-time': getAnalyticsWastedTime,
  'flaky-leaderboard': getAnalyticsFlakyLeaderboard,
  'cluster-landscape': getAnalyticsClusterLandscape,
  'regression-velocity': getAnalyticsRegressionVelocity,
  'browser-matrix': getAnalyticsBrowserMatrix,
  'slow-endpoints': getAnalyticsSlowEndpoints,
  'scenario-gaps': getAnalyticsScenarioGaps,
  'new-gaps': getAnalyticsNewGaps,
};

/**
 * Run one widget. `options` are checked against the widget's schema with the
 * defaults filled in (`WidgetOptionsError` when refused).
 */
export async function runAnalyticsWidget(
  db: DrizzleDB,
  widget: AnalyticsWidgetId,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
  options: unknown = {},
): Promise<unknown> {
  return ANALYTICS_WIDGET_HANDLERS[widget](db, scope, access, parseWidgetOptions(widget, options));
}
