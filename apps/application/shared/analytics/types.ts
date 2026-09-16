/**
 * Response payload shapes for the analytics widgets — shared between the
 * handlers (`shared/handlers/analytics/`), the demo router, and the client
 * components, so there is exactly one definition per widget payload.
 */

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
}

// ── Pass-rate heatmap ────────────────────────────────────────────────────────

export interface AnalyticsHeatmap {
  /** Bucket start dates (ISO `YYYY-MM-DD`), oldest → newest. */
  buckets: string[];
  /** Days covered by one bucket (1 = daily, 7 = weekly, …). */
  bucketDays: number;
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
