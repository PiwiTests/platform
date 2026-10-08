/**
 * Running Piwi's AI diagnosis on one failing execution (execution scope). The
 * execution's cluster, when it has one, grounds the diagnosis in the cluster's
 * evidence. Shared by `POST /api/test-run-cases/:id/diagnose` and the MCP tool
 * `run_execution_diagnosis`.
 */
import { and, eq } from 'drizzle-orm';
import { failureClusters, failureDiagnoses, testRuns, testRunsCases } from '../database/schema';
import type { FailureCluster, FailureDiagnosis } from '../database/schema';
import { resolveAiConfig, type AiAttachedImage } from './ai-provider';
import {
  runClusterDiagnosis,
  isDiagnosisRunning,
  isDiagnosisRunningForExecution,
  isDiagnosisStale,
} from './ai-diagnosis';
import type { DbClient } from '../database';

export interface ExecutionDiagnosisOptions {
  /** Re-run even when a completed diagnosis exists. */
  force?: boolean;
  additionalContext?: string;
  images?: AiAttachedImage[];
  baseCommit?: string;
  selectedCommitShas?: string[];
}

export type ExecutionDiagnosisOutcome =
  | { ok: true; diagnosis: FailureDiagnosis }
  | { ok: false; error: 'not-found' | 'not-configured' | 'running' };

/**
 * Diagnose a failing execution, or return its completed diagnosis unless
 * `force` is set. Refuses while a diagnosis of the execution, or of its
 * cluster, is running.
 */
export async function diagnoseExecution(
  db: DbClient,
  executionId: number,
  opts: ExecutionDiagnosisOptions = {},
): Promise<ExecutionDiagnosisOutcome> {
  const [trc] = await db
    .select({
      testRunId: testRunsCases.testRunId,
      failureClusterId: testRunsCases.failureClusterId,
      projectId: testRuns.projectId,
    })
    .from(testRunsCases)
    .innerJoin(testRuns, eq(testRuns.id, testRunsCases.testRunId))
    .where(eq(testRunsCases.id, executionId))
    .limit(1);
  if (!trc) return { ok: false, error: 'not-found' };

  const config = await resolveAiConfig(db);
  if (!config) return { ok: false, error: 'not-configured' };

  let cluster: FailureCluster | null = null;
  if (trc.failureClusterId) {
    [cluster = null] = await db.select().from(failureClusters).where(eq(failureClusters.id, trc.failureClusterId));
  }

  // Execution scope runs under its own key, so executions of one cluster do not share a slot.
  if (cluster && isDiagnosisRunning(cluster.id)) return { ok: false, error: 'running' };
  if (!cluster && isDiagnosisRunningForExecution(executionId)) return { ok: false, error: 'running' };

  if (!opts.force) {
    const [existing] = await db
      .select()
      .from(failureDiagnoses)
      .where(and(eq(failureDiagnoses.testRunsCaseId, executionId), eq(failureDiagnoses.scope, 'execution')))
      .limit(1);
    if (existing?.status === 'running' && !isDiagnosisStale(existing)) return { ok: false, error: 'running' };
    if (existing?.status === 'completed') return { ok: true, diagnosis: existing };
  }

  const diagnosis = await runClusterDiagnosis(
    db,
    cluster ??
      ({
        id: 0,
        projectId: trc.projectId,
        signature: 'execution-scoped',
        errorType: null,
        selector: null,
        sampleError: null,
        firstSeenRunId: trc.testRunId,
        lastSeenRunId: trc.testRunId,
        status: 'open',
        triageNote: null,
        manualBaseCommit: null,
        occurrences: 1,
        fingerprint: '',
        createdAt: new Date(),
        updatedAt: new Date(),
      } as FailureCluster),
    config,
    {
      additionalContext: opts.additionalContext,
      images: opts.images,
      baseCommit: opts.baseCommit,
      selectedCommitShas: opts.selectedCommitShas,
      testRunsCaseId: executionId,
    },
  );
  return { ok: true, diagnosis };
}
