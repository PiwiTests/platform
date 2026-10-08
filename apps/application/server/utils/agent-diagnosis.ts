/**
 * The server side of recording an agent's diagnosis: the patch is validated
 * against the source files it names, read through the project's SCM provider
 * at the commit of the run the failure was seen in, and the stored diagnosis
 * notifies like one Piwi produced. The write itself is the shared handler.
 */
import { eq } from 'drizzle-orm';
import { testRuns } from '../database/schema';
import type { AgentDiagnosisInput, AgentDiagnosisTarget } from '#shared/agent-diagnosis';
import type { HandbackActor } from '#shared/handback-outcomes';
import { recordAgentDiagnosis, type RecordAgentDiagnosisResult } from '#shared/handlers/agent-diagnosis';
import { isDiagnosisRunning, isDiagnosisRunningForExecution } from './ai-diagnosis';
import { createScmProvider } from './scm';
import { normalizeGitUrl } from './scm/git-url';
import { emitNotification } from './notifications/emit';
import type { RunMetadata } from './run-json-types';
import type { DbClient } from '../database';

/** Read the files a patch names at the commit of a run; null without SCM. */
async function loadRunSources(db: DbClient, runId: number, paths: string[]): Promise<Map<string, string> | null> {
  const [run] = await db
    .select({ projectId: testRuns.projectId, metadata: testRuns.metadata })
    .from(testRuns)
    .where(eq(testRuns.id, runId));
  const scm = (run?.metadata as RunMetadata | null)?.scm;
  const repositoryUrl = normalizeGitUrl(scm?.remoteUrl ?? null);
  if (!run || !repositoryUrl || !scm?.commit) return null;
  const provider = await createScmProvider(repositoryUrl, db, run.projectId);
  if (!provider) return null;
  const files = new Map<string, string>();
  for (const path of paths) {
    const file = await provider.fetchFileAtRef(path, scm.commit).catch(() => null);
    if (file && !file.truncated) files.set(path, file.content);
  }
  return files;
}

/** Record an agent's diagnosis on a cluster or a failure and send `diagnosis.completed`. */
export async function recordAgentDiagnosisOn(
  db: DbClient,
  target: AgentDiagnosisTarget,
  input: AgentDiagnosisInput,
  actor: HandbackActor,
): Promise<RecordAgentDiagnosisResult> {
  const running =
    target.scope === 'cluster'
      ? isDiagnosisRunning(target.clusterId)
      : isDiagnosisRunningForExecution(target.executionId);
  if (running) return { ok: false, error: 'running' };
  const result = await recordAgentDiagnosis(db, target, input, {
    actor,
    loadSources: (runId, paths) => loadRunSources(db, runId, paths),
  });
  // The event points at a cluster, so a failure in no cluster sends none.
  if (result.ok && result.clusterId != null) {
    emitNotification(db, 'diagnosis.completed', {
      clusterId: result.clusterId,
      projectId: result.projectId,
      completedAt: Date.now(),
      summary: input.diagnosis.summary,
      rootCause: input.diagnosis.rootCause,
      category: input.diagnosis.category,
      confidence: input.diagnosis.confidence,
    });
  }
  return result;
}
