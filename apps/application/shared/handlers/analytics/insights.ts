import type { DrizzleDB } from '../db';
import type { AnalyticsScope } from '../../analytics/scope';
import type { AnalyticsInsight } from '../../analytics/types';
import { evaluateInsightRules } from '../../analytics/insight-rules';
import { getAnalyticsPortfolio } from './portfolio';
import { getAnalyticsCiTimeTrend } from './ci-time-trend';
import { getAnalyticsWastedTime } from './wasted-time';
import { getAnalyticsClusterLandscape } from './cluster-landscape';
import { getAnalyticsFlakyLeaderboard } from './flaky-leaderboard';
import { getAnalyticsRegressionVelocity } from './regression-velocity';
import { getAnalyticsSlowEndpoints } from './slow-endpoints';
import { getAnalyticsTimeoutHygiene } from './timeout-hygiene';
import { getAnalyticsContext, type ProjectAccess } from './common';
import { evaluateTargets } from './targets';
import { resolveCiCost } from '../ci-cost';

/**
 * Ranked, human-readable findings over the scoped data — computed by the pure
 * rule registry in `shared/analytics/insight-rules.ts` from the other widgets'
 * aggregates, so every insight is consistent with what the page displays.
 */
export async function getAnalyticsInsights(
  db: DrizzleDB,
  scope: AnalyticsScope,
  access: ProjectAccess = 'all',
): Promise<AnalyticsInsight[]> {
  const ctx = await getAnalyticsContext(db, scope, access);
  const { cost } = await resolveCiCost(db);
  const [
    portfolio,
    ciTime,
    wastedTime,
    clusters,
    flakyTests,
    regressionVelocity,
    slowEndpoints,
    timeoutHygiene,
    targets,
  ] = await Promise.all([
    getAnalyticsPortfolio(db, scope, access),
    getAnalyticsCiTimeTrend(db, scope, access),
    getAnalyticsWastedTime(db, scope, access),
    getAnalyticsClusterLandscape(db, scope, access),
    getAnalyticsFlakyLeaderboard(db, scope, access),
    getAnalyticsRegressionVelocity(db, scope, access),
    getAnalyticsSlowEndpoints(db, scope, access),
    getAnalyticsTimeoutHygiene(db, scope, access),
    evaluateTargets(db, ctx, cost),
  ]);

  return evaluateInsightRules({
    scope,
    portfolio,
    ciTime,
    wastedTime,
    clusters,
    flakyTests,
    regressionVelocity,
    slowEndpoints,
    timeoutHygiene,
    targets,
  });
}
