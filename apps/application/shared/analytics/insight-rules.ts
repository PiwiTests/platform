/**
 * Rule registry for the analytics insights feed. Every rule is a pure
 * function over the already-computed widget aggregates — no DB access — so
 * rules are trivially unit-testable and adding one is a single entry here.
 */

import type {
  AnalyticsCiTimeTrend,
  AnalyticsClusterLandscape,
  AnalyticsFlakyDebt,
  AnalyticsFlakyRow,
  AnalyticsInsight,
  AnalyticsOwnership,
  AnalyticsPortfolioRow,
  AnalyticsRegressionVelocity,
  AnalyticsSlowEndpoints,
  AnalyticsSuiteGrowth,
  AnalyticsTimeToFix,
  AnalyticsTimeoutHygiene,
  AnalyticsWastedTime,
} from './types';
import type { AnalyticsScope } from './scope';
import { getMetric } from './metrics';
import type { ProjectTargetVerdict } from './targets';

export interface InsightContext {
  scope: AnalyticsScope;
  portfolio: AnalyticsPortfolioRow[];
  ciTime: AnalyticsCiTimeTrend;
  wastedTime: AnalyticsWastedTime;
  clusters: AnalyticsClusterLandscape;
  flakyTests: AnalyticsFlakyRow[];
  regressionVelocity: AnalyticsRegressionVelocity;
  slowEndpoints: AnalyticsSlowEndpoints;
  timeoutHygiene: AnalyticsTimeoutHygiene;
  /** The targets of the projects in scope over the period, met or missed. */
  targets?: ProjectTargetVerdict[];
  timeToFix?: AnalyticsTimeToFix;
  suiteGrowth?: AnalyticsSuiteGrowth;
  flakyDebt?: AnalyticsFlakyDebt;
  ownership?: AnalyticsOwnership;
}

export interface InsightRule {
  id: string;
  evaluate(ctx: InsightContext): AnalyticsInsight[];
}

const SEVERITY_ORDER: Record<AnalyticsInsight['severity'], number> = {
  critical: 0,
  warning: 1,
  info: 2,
  positive: 3,
};

/** How an insight names the period a change is measured against. */
export function comparisonPhrase(scope: AnalyticsScope): string {
  const { period, comparison } = scope;
  if (comparison.kind === 'year') return 'the same period a year earlier';
  if (comparison.kind === 'range') return `${comparison.from} to ${comparison.to}`;
  if (comparison.kind === 'previous-unit') {
    if (period.kind === 'calendar') return `the previous ${period.unit}`;
    if (period.kind === 'release') return 'the previous release cycle';
    if (period.kind === 'sprint') return 'the previous sprint';
  }
  if (period.kind === 'rolling') return `the previous ${period.days} days`;
  return 'the previous period';
}

function projectDisplay(row: { name: string; label: string | null }): string {
  return row.label || row.name;
}

const passRateDrop: InsightRule = {
  id: 'pass-rate-drop',
  evaluate: ({ portfolio, scope }) =>
    portfolio
      .filter((p) => p.passRateDelta !== null && p.passRateDelta <= -5 && p.runCount >= 3)
      .map((p) => ({
        id: `pass-rate-drop:${p.projectId}`,
        ruleId: 'pass-rate-drop',
        severity: p.passRateDelta! <= -15 ? ('critical' as const) : ('warning' as const),
        message: `${projectDisplay(p)} pass rate dropped ${Math.abs(p.passRateDelta!)} pts vs ${comparisonPhrase(scope)}`,
        detail: `Now at ${p.passRate}% over ${p.runCount} runs.`,
        to: `/projects/${p.projectId}`,
        projectId: p.projectId,
      })),
};

const passRateRecovery: InsightRule = {
  id: 'pass-rate-recovery',
  evaluate: ({ portfolio, scope }) =>
    portfolio
      .filter((p) => p.passRateDelta !== null && p.passRateDelta >= 10 && p.runCount >= 3)
      .map((p) => ({
        id: `pass-rate-recovery:${p.projectId}`,
        ruleId: 'pass-rate-recovery',
        severity: 'positive' as const,
        message: `${projectDisplay(p)} pass rate improved ${p.passRateDelta} pts vs ${comparisonPhrase(scope)}`,
        detail: `Now at ${p.passRate}% over ${p.runCount} runs.`,
        to: `/projects/${p.projectId}`,
        projectId: p.projectId,
      })),
};

const failingStreak: InsightRule = {
  id: 'failing-streak',
  evaluate: ({ portfolio }) =>
    portfolio
      .filter((p) => p.failingStreak >= 3)
      .map((p) => ({
        id: `failing-streak:${p.projectId}`,
        ruleId: 'failing-streak',
        severity: 'critical' as const,
        message: `${projectDisplay(p)} has failed ${p.failingStreak} runs in a row`,
        detail: p.latestRun ? `Latest run #${p.latestRun.id} ${p.latestRun.status}.` : undefined,
        to: `/projects/${p.projectId}`,
        projectId: p.projectId,
      })),
};

const staleCluster: InsightRule = {
  id: 'stale-cluster',
  evaluate: ({ clusters }) =>
    clusters.clusters
      .filter((c) => c.ageDays >= 14 && c.occurrences >= 10)
      .slice(0, 3)
      .map((c) => ({
        id: `stale-cluster:${c.id}`,
        ruleId: 'stale-cluster',
        severity: c.ageDays >= 30 ? ('critical' as const) : ('warning' as const),
        message: `"${c.title || c.signature}" has been open for ${c.ageDays} days (${c.occurrences} occurrences)`,
        detail: `${projectDisplay({ name: c.projectName, label: c.projectLabel })} · ${c.errorType ?? 'unknown'} error.`,
        to: `/failure-clusters/${c.id}`,
        projectId: c.projectId,
      })),
};

const ciTimeGrowth: InsightRule = {
  id: 'ci-time-growth',
  evaluate: ({ ciTime, scope }) => {
    if (ciTime.deltaPct === null || ciTime.deltaPct < 25 || ciTime.totalMinutes < 30) return [];
    return [
      {
        id: 'ci-time-growth',
        ruleId: 'ci-time-growth',
        severity: ciTime.deltaPct >= 50 ? 'warning' : 'info',
        message: `CI time grew ${ciTime.deltaPct}% vs ${comparisonPhrase(scope)}`,
        detail: `${Math.round(ciTime.totalMinutes)} minutes across ${ciTime.runCount} runs this period.`,
      },
    ];
  },
};

const wastedCiTime: InsightRule = {
  id: 'wasted-ci-time',
  evaluate: ({ wastedTime }) => {
    const totalWasted = wastedTime.totalWaitMinutes + wastedTime.totalFailedExecMinutes;
    if (totalWasted < 60) return [];
    const worst = wastedTime.byProject[0];
    const hours = Math.round((totalWasted / 60) * 10) / 10;
    return [
      {
        id: 'wasted-ci-time',
        ruleId: 'wasted-ci-time',
        severity: totalWasted >= 240 ? 'warning' : 'info',
        message: `${hours} h of CI time went to waits and failed attempts this period`,
        detail: worst
          ? `${projectDisplay(worst)} alone accounts for ${Math.round(worst.waitMinutes + worst.failedExecMinutes)} minutes.`
          : undefined,
        to: worst ? `/projects/${worst.projectId}` : undefined,
        projectId: worst?.projectId,
      },
    ];
  },
};

const topFlakyImpact: InsightRule = {
  id: 'top-flaky-impact',
  evaluate: ({ flakyTests }) =>
    flakyTests
      .filter((t) => t.wastedCiMinutes >= 10)
      .slice(0, 2)
      .map((t) => ({
        id: `top-flaky-impact:${t.testCaseId}`,
        ruleId: 'top-flaky-impact',
        severity: 'warning' as const,
        message: `"${t.title}" wasted ${Math.round(t.wastedCiMinutes)} CI minutes on flaky retries`,
        detail: `${projectDisplay({ name: t.projectName, label: t.projectLabel })} · flaked in ${t.retryPassRuns} of ${t.totalRuns} recent runs.`,
        to: `/test-cases/${t.testCaseId}`,
        projectId: t.projectId,
      })),
};

const regressionSurge: InsightRule = {
  id: 'regression-surge',
  evaluate: ({ regressionVelocity, scope }) => {
    const { totalRegressions, prevRegressions, deltaPct } = regressionVelocity;
    if (totalRegressions < 5 || deltaPct === null || deltaPct < 50) return [];
    return [
      {
        id: 'regression-surge',
        ruleId: 'regression-surge',
        severity: deltaPct >= 100 ? 'warning' : 'info',
        message: `New regressions rose ${deltaPct}% vs ${comparisonPhrase(scope)}`,
        detail: `${totalRegressions} this period, up from ${prevRegressions}.`,
      },
    ];
  },
};

const slowSharedEndpoint: InsightRule = {
  id: 'slow-shared-endpoint',
  evaluate: ({ slowEndpoints }) =>
    slowEndpoints.endpoints
      // A slow call hit by several projects points at a shared backend, not one flaky test.
      .filter((ep) => ep.projectCount >= 2 && ep.p90Ms >= 1000)
      .slice(0, 2)
      .map((ep) => ({
        id: `slow-shared-endpoint:${ep.method}:${ep.route}`,
        ruleId: 'slow-shared-endpoint',
        severity: 'warning' as const,
        message: `${ep.method} ${ep.route} is slow (p90 ${ep.p90Ms} ms) across ${ep.projectCount} projects`,
        detail: `${ep.requests} requests this period${ep.errorRate > 0 ? ` · ${ep.errorRate}% errored` : ''}.`,
      })),
};

/** Compact ms → human string for insight copy (e.g. 90000 → "90s"). */
function fmtMs(ms: number): string {
  if (ms >= 1000) return `${Math.round(ms / 1000)}s`;
  return `${Math.round(ms)}ms`;
}

const timeoutHygiene: InsightRule = {
  id: 'timeout-hygiene',
  evaluate: ({ timeoutHygiene }) =>
    timeoutHygiene.rows
      // Only surface materially wasteful budgets in the cross-project feed;
      // the per-project table shows the long tail.
      .filter((r) => r.estimatedSavingMs >= 15_000)
      .slice(0, 2)
      .map((r) => ({
        id: `timeout-hygiene:${r.testCaseId}`,
        ruleId: 'timeout-hygiene',
        severity: r.estimatedSavingMs >= 60_000 ? ('warning' as const) : ('info' as const),
        message:
          r.kind === 'stale-slow'
            ? `"${r.title}" is still marked test.slow() but runs well under budget`
            : `"${r.title}" has an oversized timeout (${fmtMs(r.timeout ?? 0)} vs p95 ${fmtMs(r.p95)})`,
        detail:
          `${projectDisplay({ name: r.projectName, label: r.projectLabel })} · ` +
          (r.kind === 'stale-slow'
            ? `remove test.slow() to reclaim ~${fmtMs(r.estimatedSavingMs)} per failing run.`
            : `lower it toward ${fmtMs(r.recommendedTimeout ?? 0)} to reclaim ~${fmtMs(r.estimatedSavingMs)} per failing run.`),
        to: `/test-cases/${r.testCaseId}`,
        projectId: r.projectId,
      })),
};

/** How far off a target a value is, in the metric's unit ("1.2 pts", "3 days"). */
function targetGap(v: ProjectTargetVerdict): string {
  const def = getMetric(v.metric);
  const gap = Math.abs((v.actual ?? 0) - v.target);
  const rounded = Math.round(gap * 10 ** def.precision) / 10 ** def.precision;
  const unit = def.unit === 'percent' ? 'pts' : def.unit === 'days' ? 'days' : def.unit === 'minutes' ? 'min' : '';
  return unit ? `${rounded} ${unit}` : `${rounded}`;
}

function targetValue(v: ProjectTargetVerdict, value: number): string {
  const def = getMetric(v.metric);
  if (def.unit === 'percent') return `${value}%`;
  if (def.unit === 'days') return `${value} days`;
  if (def.unit === 'minutes') return `${value} min`;
  return String(value);
}

const targetMissed: InsightRule = {
  id: 'target-missed',
  evaluate: ({ targets = [] }) =>
    targets
      .filter((t) => t.met === false && t.actual !== null)
      .map((t) => {
        const label = getMetric(t.metric).label.toLowerCase();
        const side = t.direction === 'min' ? 'under' : 'over';
        const bound = t.direction === 'min' ? 'at least' : 'at most';
        // A pass rate target missed by more than 5 points is critical; the rest warn.
        const critical = t.metric === 'test-pass-rate' && t.target - (t.actual ?? 0) > 5;
        return {
          id: `target-missed:${t.projectId}:${t.key}`,
          ruleId: 'target-missed',
          severity: critical ? ('critical' as const) : ('warning' as const),
          message: `${t.projectName} ${label} is ${targetGap(t)} ${side} its target`,
          detail: `${targetValue(t, t.actual!)} against a target of ${bound} ${targetValue(t, t.target)}.`,
          to: `/projects/${t.projectId}?tab=settings`,
          projectId: t.projectId,
        };
      }),
};

const timeToFixGrowth: InsightRule = {
  id: 'time-to-fix-growth',
  evaluate: ({ timeToFix, scope }) => {
    if (!timeToFix || timeToFix.fixed < 3) return [];
    const { medianDays: now, previousMedianDays: before } = timeToFix;
    // Half again as long, and at least a day longer: a fix now waits noticeably more.
    if (now === null || before === null || before <= 0 || now < before * 1.5 || now - before < 1) return [];
    return [
      {
        id: 'time-to-fix-growth',
        ruleId: 'time-to-fix-growth',
        severity: now >= before * 2 ? 'warning' : 'info',
        message: `Median time to fix grew to ${now} days vs ${comparisonPhrase(scope)}`,
        detail: `Up from ${before} days, over ${timeToFix.fixed} failure causes fixed this period.`,
      },
    ];
  },
};

const suiteShrank: InsightRule = {
  id: 'suite-shrank',
  evaluate: ({ suiteGrowth, scope }) => {
    if (!suiteGrowth || suiteGrowth.delta === null || suiteGrowth.previousSuiteSize === null) return [];
    const lost = -suiteGrowth.delta;
    // Five tests or five percent, whichever is more: a rename or two is not a shrink.
    if (lost < Math.max(5, suiteGrowth.previousSuiteSize * 0.05)) return [];
    return [
      {
        id: 'suite-shrank',
        ruleId: 'suite-shrank',
        severity: lost >= suiteGrowth.previousSuiteSize * 0.2 ? 'warning' : 'info',
        message: `The suite shrank by ${lost} tests vs ${comparisonPhrase(scope)}`,
        detail: `From ${suiteGrowth.previousSuiteSize} to ${suiteGrowth.suiteSize} tests; check nothing was skipped or deleted by mistake.`,
      },
    ];
  },
};

const quarantineDebtGrowth: InsightRule = {
  id: 'quarantine-debt-growth',
  evaluate: ({ flakyDebt, scope }) => {
    if (!flakyDebt || flakyDebt.previousQuarantined === null) return [];
    const added = flakyDebt.quarantined - flakyDebt.previousQuarantined;
    if (added < 3 && !(added > 0 && flakyDebt.previousQuarantined > 0 && added >= flakyDebt.previousQuarantined * 0.5))
      return [];
    return [
      {
        id: 'quarantine-debt-growth',
        ruleId: 'quarantine-debt-growth',
        severity: added >= 10 ? 'warning' : 'info',
        message: `${added} more tests in quarantine vs ${comparisonPhrase(scope)}`,
        detail: `${flakyDebt.quarantined} tests are in quarantine now, up from ${flakyDebt.previousQuarantined}.`,
      },
    ];
  },
};

const ownerLoad: InsightRule = {
  id: 'owner-load',
  evaluate: ({ ownership }) => {
    if (!ownership || ownership.totalOpenClusters < 4) return [];
    const top = ownership.rows
      .filter((r) => r.owner !== null)
      .reduce<AnalyticsOwnership['rows'][number] | null>(
        (best, r) => (best === null || r.openClusters > best.openClusters ? r : best),
        null,
      );
    if (!top || top.openClusters * 2 <= ownership.totalOpenClusters) return [];
    const share = Math.round((top.openClusters / ownership.totalOpenClusters) * 100);
    return [
      {
        id: `owner-load:${top.owner}`,
        ruleId: 'owner-load',
        severity: 'warning',
        message: `${top.owner} holds ${top.openClusters} of the ${ownership.totalOpenClusters} open failure causes`,
        detail: `${share}% of the open failure causes wait on one owner.`,
      },
    ];
  },
};

export const INSIGHT_RULES: InsightRule[] = [
  targetMissed,
  ownerLoad,
  timeToFixGrowth,
  suiteShrank,
  quarantineDebtGrowth,
  failingStreak,
  passRateDrop,
  staleCluster,
  topFlakyImpact,
  regressionSurge,
  slowSharedEndpoint,
  wastedCiTime,
  timeoutHygiene,
  ciTimeGrowth,
  passRateRecovery,
];

export function evaluateInsightRules(ctx: InsightContext): AnalyticsInsight[] {
  return INSIGHT_RULES.flatMap((rule) => rule.evaluate(ctx)).sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity],
  );
}
