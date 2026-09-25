/**
 * Response payload shapes for the analytics widgets — shared between the
 * handlers (`shared/handlers/analytics/`), the demo router, and the client
 * components, so there is exactly one definition per widget payload.
 */

import type { MetricId, MetricUnit } from './metrics';
import type { ProjectTargetVerdict } from './targets';

export interface AnalyticsTagInfo {
  id: number;
  text: string;
  color: string;
}

export interface AnalyticsSparkRun {
  id: number;
  status: string;
  passedTests: number;
  failedTests: number;
  flakyTests: number;
  totalTests: number;
  startTime: string | Date;
}

// ── Portfolio scorecard ──────────────────────────────────────────────────────

export interface AnalyticsPortfolioRow {
  projectId: number;
  name: string;
  label: string | null;
  tags: AnalyticsTagInfo[];
  /** Terminal runs inside the period. */
  runCount: number;
  /** Tests passed / tests run across all period runs, 0–100. Null when no tests ran. */
  passRate: number | null;
  /** Percentage-point change vs the previous equal-length period. Null without a baseline. */
  passRateDelta: number | null;
  /** Sum of flaky test occurrences across period runs. */
  flakyTests: number;
  avgRunDurationMs: number | null;
  openClusters: number;
  /** Consecutive failing runs at the newest end of the period. */
  failingStreak: number;
  latestRun: { id: number; status: string; startTime: string | Date } | null;
  /** Last runs of the period (oldest → newest), for the trend bars. */
  recentRuns: AnalyticsSparkRun[];
  /** The project's targets over the period, met or missed; empty when it has none. */
  targets: ProjectTargetVerdict[];
}

// ── Pass-rate heatmap ────────────────────────────────────────────────────────

export interface AnalyticsHeatmap {
  /** Bucket start dates (ISO `YYYY-MM-DD`), oldest → newest. */
  buckets: string[];
  /** Days covered by one bucket (1 = daily, 7 = weekly, 30 = monthly). */
  bucketDays: number;
  /** True when a cell is a calendar month. */
  monthly?: boolean;
  rows: Array<{
    projectId: number;
    name: string;
    label: string | null;
    /** Pass rate (0–100) per bucket; null = no runs in that bucket. */
    cells: Array<number | null>;
  }>;
}

// ── CI time trend ────────────────────────────────────────────────────────────

export interface AnalyticsCiTimePoint {
  /** Bucket start date (ISO `YYYY-MM-DD`). */
  date: string;
  totalMinutes: number;
  runCount: number;
}

export interface AnalyticsCiTimeTrend {
  points: AnalyticsCiTimePoint[];
  bucketDays: number;
  totalMinutes: number;
  runCount: number;
  /** Total minutes in the previous equal-length period. Null without a baseline. */
  prevTotalMinutes: number | null;
  /** Percent change vs the previous period. Null without a baseline. */
  deltaPct: number | null;
  avgRunMinutes: number | null;
}

// ── Wasted CI time ───────────────────────────────────────────────────────────

export interface AnalyticsWastedTimePoint {
  /** Bucket start date (ISO `YYYY-MM-DD`). */
  date: string;
  /** Minutes spent inside wait steps (waitFor*, timeouts). */
  waitMinutes: number;
  /** Minutes spent executing attempts that ended failed or timed out. */
  failedExecMinutes: number;
}

export interface AnalyticsWastedTime {
  points: AnalyticsWastedTimePoint[];
  bucketDays: number;
  totalWaitMinutes: number;
  totalFailedExecMinutes: number;
  byProject: Array<{
    projectId: number;
    name: string;
    label: string | null;
    waitMinutes: number;
    failedExecMinutes: number;
  }>;
  /**
   * Timeout-hygiene tie-in: much of the "failed attempts" time is tests hitting
   * an oversized timeout, so this is the wait reclaimable (upper bound) by
   * tightening oversized timeouts and removing stale `test.slow()` marks in
   * scope. Null when no opportunities were found.
   */
  /**
   * The wasted minutes as money, when a cost of a CI minute is configured
   * (Settings → Performance, `PIWI_CI_MINUTE_COST`); null otherwise.
   */
  cost: { amount: number; currency: string } | null;
  timeoutReclaimable: {
    /** Sum of per-failure savings across opportunities, in minutes. */
    estimatedMinutes: number;
    oversizedCount: number;
    staleSlowCount: number;
    /** Project of the highest-impact opportunity (for a deep link). */
    topProjectId: number | null;
  } | null;
}

// ── Global flaky leaderboard ─────────────────────────────────────────────────

export interface AnalyticsFlakyRow {
  projectId: number;
  projectName: string;
  projectLabel: string | null;
  testCaseId: number;
  latestRunsCaseId: number;
  title: string;
  filePath: string;
  totalRuns: number;
  retryPassRuns: number;
  alternations: number;
  score: number;
  rootCause: string | null;
  impact: number;
  wastedCiMinutes: number;
  lastFlakeAt: string | Date | null;
}

// ── Failure-cluster landscape ────────────────────────────────────────────────

export interface AnalyticsClusterRow {
  id: number;
  projectId: number;
  projectName: string;
  projectLabel: string | null;
  title: string | null;
  signature: string;
  errorType: string | null;
  selector: string | null;
  occurrences: number;
  ageDays: number;
  firstSeenAt: string | Date;
}

export interface AnalyticsClusterLandscape {
  totalOpen: number;
  /** Clusters resolved inside the period (by `updatedAt`). */
  resolvedInPeriod: number;
  byErrorType: Array<{ errorType: string; count: number }>;
  /** Top open clusters by occurrences. */
  clusters: AnalyticsClusterRow[];
}

// ── Regression velocity ──────────────────────────────────────────────────────

export interface AnalyticsRegressionPoint {
  /** Bucket start date (ISO `YYYY-MM-DD`). */
  date: string;
  /** Executions first failing this period (`isNewRegression`). */
  regressions: number;
  /** Executions newly flaky this period (`isNewFlaky`). */
  newFlaky: number;
}

export interface AnalyticsRegressionVelocity {
  points: AnalyticsRegressionPoint[];
  bucketDays: number;
  totalRegressions: number;
  totalNewFlaky: number;
  /** Regressions in the previous equal-length period. Null without a baseline. */
  prevRegressions: number | null;
  deltaPct: number | null;
}

// ── Browser matrix ───────────────────────────────────────────────────────────

export interface AnalyticsBrowserMatrix {
  /** Browser identities present in the period (column order). */
  browsers: string[];
  rows: Array<{
    projectId: number;
    name: string;
    label: string | null;
    /** Pass rate (0–100) per browser; null = the project ran no tests on it. */
    cells: Array<number | null>;
  }>;
}

// ── Slow endpoints ───────────────────────────────────────────────────────────

export interface AnalyticsSlowEndpointRow {
  method: string;
  route: string;
  requests: number;
  p50Ms: number;
  p90Ms: number;
  maxMs: number;
  /** Share of requests with a 4xx/5xx status, 0–100. */
  errorRate: number;
  /** Distinct projects that hit this endpoint (shared-backend signal). */
  projectCount: number;
}

export interface AnalyticsSlowEndpoints {
  endpoints: AnalyticsSlowEndpointRow[];
  totalRequests: number;
}

// ── Insights feed ────────────────────────────────────────────────────────────

export type AnalyticsInsightSeverity = 'critical' | 'warning' | 'info' | 'positive';

export interface AnalyticsInsight {
  /** Stable id (`ruleId:subject`) so the client can key the list. */
  id: string;
  ruleId: string;
  severity: AnalyticsInsightSeverity;
  message: string;
  detail?: string;
  /** In-app route the insight deep-links to. */
  to?: string;
  projectId?: number;
}

// ── Timeout hygiene ───────────────────────────────────────────────────────────

/** One cross-project timeout-reduction opportunity (see `timeout-hygiene.ts`). */
export interface AnalyticsTimeoutRow {
  projectId: number;
  projectName: string;
  projectLabel: string | null;
  testCaseId: number;
  title: string;
  filePath: string;
  kind: 'oversized-timeout' | 'stale-slow';
  timeout: number | null;
  p95: number;
  recommendedTimeout: number | null;
  estimatedSavingMs: number;
  impact: number;
  hasSlowAnnotation: boolean;
}

export interface AnalyticsTimeoutHygiene {
  rows: AnalyticsTimeoutRow[];
  oversizedCount: number;
  staleSlowCount: number;
  totalEstimatedSavingMs: number;
  /** Project of the highest-impact opportunity (for a deep link). */
  topProjectId: number | null;
}

// ── Scope summary ────────────────────────────────────────────────────────────

/** A timeline marker drawn on a trend, labeled with its project across projects. */
export interface AnalyticsMarker {
  id: number;
  projectId: number;
  projectName: string | null;
  occurredAt: string | Date;
  label: string;
  description: string | null;
  category: string;
  environment: string | null;
  source: string;
  runId: number | null;
  createdAt: string | Date;
  updatedAt: string | Date;
}

export interface AnalyticsResolvedPeriod {
  /** ISO instants; `to` is exclusive. */
  from: string;
  to: string;
  label: string;
  /** Why the definition could not be used and the default period was shown instead. */
  fallback: string | null;
}

/** How a scope resolved: what the scope bar and the trend charts show around the widgets. */
export interface AnalyticsScopeSummary {
  period: AnalyticsResolvedPeriod;
  comparison: AnalyticsResolvedPeriod | null;
  notes: string[];
  /** Markers inside the period: every marker with one project in scope, else releases, infra and incidents. */
  markers: AnalyticsMarker[];
  /** Recent markers of the projects in scope, for the periods anchored on a marker. */
  anchors: AnalyticsMarker[];
  /** Selection keys known in the projects in scope, built-ins included. */
  selections: Array<{ key: string; name: string }>;
  /** Browsers the recent runs in scope ran on. */
  browsers: string[];
  /** Oldest UTC day of rollup data inside the period, null when there is none. */
  dataStartsAt: string | null;
  projectCount: number;
}

// ── Metric values (stats, metric, verdict) ───────────────────────────────────

/** One point of a metric series; null = nothing to count in that bucket. */
export interface AnalyticsSeriesPoint {
  /** Bucket start date (ISO `YYYY-MM-DD`). */
  date: string;
  value: number | null;
}

/** A metric's value over the period, with its comparison. */
export interface AnalyticsMetricValue {
  metric: MetricId;
  label: string;
  unit: MetricUnit;
  betterWhen: 'higher' | 'lower' | 'neutral';
  definition: string;
  precision: number;
  source: 'rollup' | 'live';
  value: number | null;
  /** The value over the comparison period. Null without a comparison or a baseline. */
  previous: number | null;
  /** `value - previous`, in points for a percentage. */
  delta: number | null;
  /** Relative change in percent, for units other than a percentage. */
  deltaPct: number | null;
  /** Whether the change reads as better or worse given the metric's direction. */
  trend: 'better' | 'worse' | 'same' | null;
  /** Currency of a money metric. */
  currency: string | null;
}

/** The target mark of a tile: how many projects in scope meet the metric's target. */
export interface AnalyticsTileTarget {
  /** The target over the period, when one project is in scope; null across projects. */
  target: number | null;
  direction: 'min' | 'max';
  /** Projects meeting and missing the target; a project with nothing to judge counts in neither. */
  met: number;
  missed: number;
}

export interface AnalyticsStatTile extends AnalyticsMetricValue {
  /** A second number shown under the tile (the cost of wasted minutes, the median time to fix). */
  companion: AnalyticsMetricValue | null;
  /** The metric's target, when a project in scope sets one. */
  target: AnalyticsTileTarget | null;
}

export interface AnalyticsStats {
  tiles: AnalyticsStatTile[];
  /** Label of the comparison period; null when the scope compares with nothing. */
  comparisonLabel: string | null;
}

/** One group of a metric breakdown, with its value and change like the whole metric's. */
export interface AnalyticsBreakdownGroup {
  key: string;
  label: string;
  value: AnalyticsMetricValue;
  /** The group's series over the period (line, bar over time and heatmap displays); null otherwise. */
  points: AnalyticsSeriesPoint[] | null;
  /** The group of everything outside the top groups. */
  other: boolean;
}

export interface AnalyticsMetricWidget {
  /** The display drawn: `stat` when the metric has no series to draw the one asked for. */
  display: 'line' | 'stat' | 'bar' | 'table' | 'heatmap';
  value: AnalyticsMetricValue;
  bucketDays: number;
  /** The series over the period; empty for the stat display or a metric with no series. */
  points: AnalyticsSeriesPoint[];
  /** The comparison period's series, aligned bucket for bucket; null when off or absent. */
  previousPoints: AnalyticsSeriesPoint[] | null;
  comparisonLabel: string | null;
  /** The metric cut by a dimension, top groups first; null without a breakdown. */
  breakdown: { dimension: string; label: string; groups: AnalyticsBreakdownGroup[] } | null;
  /**
   * The target line, with the target switch on and one project in scope that
   * sets a target on the metric; a weekly target is scaled to one bucket.
   */
  target: { value: number; direction: 'min' | 'max'; met: boolean | null } | null;
}

// ── Verdict, progress, risks ────────────────────────────────────────────────

export type VerdictTone = 'good' | 'mixed' | 'bad';

/** The numbers the rule-based verdict is built from. */
export interface VerdictFacts {
  runs: number;
  passRate: number | null;
  previousPassRate: number | null;
  /** Change in percentage points against the comparison period. */
  passRateDelta: number | null;
  fixed: number;
  opened: number;
  open: number;
  wastedMinutes: number;
  wastedCost: { amount: number; currency: string } | null;
  /** Which runs count: each project's default branch (named), every branch, or branches chosen by hand. */
  branch: { kind: 'default' | 'any' | 'list'; branches: string[] };
  comparison: 'previous' | 'previous-unit' | 'year' | 'custom' | 'none';
}

export interface AnalyticsVerdict {
  tone: VerdictTone;
  facts: VerdictFacts;
}

export interface AnalyticsClusterItem {
  id: number;
  projectId: number;
  projectName: string;
  title: string;
  /** Days since the cluster was first seen. */
  ageDays: number;
  assignee: string | null;
  occurrences: number;
}

export interface AnalyticsProgress {
  /** Failure causes whose fix landed in the period. */
  fixed: number;
  /** Of those, the ones that have not failed again. */
  held: number;
  /** Open failure causes someone is assigned to. */
  assigned: number;
  /** Open failure causes linked to a tracker ticket. */
  withTicket: number;
  releasedFromQuarantine: number;
  quarantined: number;
  /** Auto-heal pull requests opened in the period. */
  healPullRequests: number;
  /** The fixes of the period, newest first. */
  recentFixes: Array<AnalyticsClusterItem & { fixedAt: string; held: boolean }>;
}

export interface AnalyticsRiskMetric {
  metric: MetricId;
  label: string;
  unit: MetricUnit;
  value: number | null;
  previous: number | null;
  delta: number | null;
  deltaPct: number | null;
}

export interface AnalyticsRisks {
  /** Metrics that moved the wrong way by more than their threshold. */
  worsening: AnalyticsRiskMetric[];
  /** Projects whose latest runs failed in a row, longest streak first. */
  failingProjects: Array<{ projectId: number; name: string; streak: number }>;
  /** The oldest open failure causes. */
  oldestOpen: AnalyticsClusterItem[];
  openCount: number;
  quarantine: { count: number; oldestDays: number | null };
  /** Targets the projects in scope missed over the period. */
  missedTargets: ProjectTargetVerdict[];
}

/** Open scenario gaps of the projects in scope whose Test Map is active. Counts, never a coverage percentage. */
export interface AnalyticsScenarioGaps {
  /** Projects of the scope whose Test Map is active; the widget renders nothing when none is. */
  projects: number;
  /** Projects of the scope that declined the Test Map, left out. */
  declined: number;
  /** Open gaps (`kind = gap`), by class, most severe first. */
  byClass: Array<{ class: string; count: number }>;
  /** The features with the most open gaps. */
  byFeature: Array<{
    feature: string;
    projectId: number;
    projectName: string;
    count: number;
    worstClass: string | null;
  }>;
  /** Gaps closed inside the period. */
  closed: number;
  /** Gaps accepted more than a week ago whose test was never written. */
  acceptedUnwritten: number;
  /** Open resilience findings (`kind = finding`). */
  findings: number;
}

/** The Test Map's weekly digest: the top new gaps per project since the period started. */
export interface AnalyticsNewGaps {
  projects: number;
  items: Array<{
    projectId: number;
    projectName: string;
    gaps: Array<{ id: number; title: string; class: string; score: number | null; createdAt: number }>;
  }>;
}

// ── List, events, note and the single-project analyses ──────────────────────

export interface AnalyticsListItem {
  id: number;
  title: string;
  /** One line of facts (status, counts, age), plain text. */
  detail: string;
  projectName: string;
  /** When the item happened or was last seen (ISO). */
  at: string | null;
  /** Where the item opens in the app. */
  href: string;
}

export interface AnalyticsList {
  source: 'runs' | 'failure-clusters' | 'flaky-tests' | 'scenario-gaps';
  items: AnalyticsListItem[];
  /** Projects left out because they declined the Test Map (scenario gaps only). */
  declined: number;
}

export interface AnalyticsEvents {
  markers: AnalyticsMarker[];
}

export interface AnalyticsNote {
  /** The note rendered from Markdown, raw HTML escaped. */
  html: string;
  markdown: string;
}

/** The single-project analyses answer only when the scope resolves to one project. */
export type AnalyticsProjectAnalysis<T> =
  | { project: { id: number; name: string }; data: T }
  | { project: null; reason: string };

// ── Suite growth ─────────────────────────────────────────────────────────────

export interface AnalyticsSuiteGrowthPoint {
  /** Bucket start date (ISO `YYYY-MM-DD`). */
  date: string;
  /** Highest number of tests one run of the bucket reported; null without a run. */
  suiteSize: number | null;
  /** Skipped tests over tests reported, 0–100. */
  skippedPct: number | null;
  /** Tests that did not run over tests reported, 0–100. */
  didNotRunPct: number | null;
}

export interface AnalyticsSuiteGrowth {
  points: AnalyticsSuiteGrowthPoint[];
  bucketDays: number;
  /** Suite size over the period and over the comparison period. */
  suiteSize: number | null;
  previousSuiteSize: number | null;
  /** Tests gained (positive) or lost (negative) against the comparison period. */
  delta: number | null;
  skippedPct: number | null;
  didNotRunPct: number | null;
}
