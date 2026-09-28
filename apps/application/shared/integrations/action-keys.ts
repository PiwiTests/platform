/**
 * The dedupe keys for every integration outbox action. A key is the identity of
 * a write: a second click, a re-emitted event or a re-run enqueues the same key
 * and is a no-op. Pure and centralized so the callers and the tests agree on the
 * exact string.
 */

/** One create-issue per (entity, connection) — a second click never files twice. */
export function createIssueKey(entityType: string, entityId: number, connectionId: number): string {
  return `create-issue:${entityType}:${entityId}:conn${connectionId}`;
}

/** One fix comment per cluster per run. */
export function fixCommentKey(clusterId: number, runId: number): string {
  return `comment:failure_cluster:${clusterId}:fixed:r${runId}`;
}

/** One fix transition per cluster per run. */
export function fixTransitionKey(clusterId: number, runId: number): string {
  return `transition:failure_cluster:${clusterId}:fixed:r${runId}`;
}

/** One regression comment per cluster per run. */
export function regressionCommentKey(clusterId: number, runId: number): string {
  return `comment:failure_cluster:${clusterId}:regressed:r${runId}`;
}

/** One reopen transition per cluster per run. */
export function reopenTransitionKey(clusterId: number, runId: number): string {
  return `transition:failure_cluster:${clusterId}:reopen:r${runId}`;
}

/** One still-failing comment per cluster per day (`date` is `YYYY-MM-DD`). */
export function occurrencesCommentKey(clusterId: number, date: string): string {
  return `comment:failure_cluster:${clusterId}:occurrences:${date}`;
}

/** One merge comment per (cluster, other cluster) pair. */
export function mergeCommentKey(clusterId: number, otherClusterId: number): string {
  return `comment:failure_cluster:${clusterId}:merge:${otherClusterId}`;
}

/** One attachment per issue and file. */
export function attachKey(bugReportId: number, issueKey: string, fileName: string): string {
  return `attach:bug_report:${bugReportId}:${issueKey}:${fileName}`;
}

/** One looks-fixed comment per bug report per run. */
export function bugLooksFixedCommentKey(bugReportId: number, runId: number): string {
  return `comment:bug-looks-fixed:${bugReportId}:run${runId}`;
}

/** One fix transition per bug report per run. */
export function bugFixTransitionKey(bugReportId: number, runId: number): string {
  return `transition:bug-fix:${bugReportId}:run${runId}`;
}
