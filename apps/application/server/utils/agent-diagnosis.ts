/**
 * The server side of recording an agent's diagnosis: the patch is validated
 * against the source files it names, read through the project's SCM provider
 * at the commit the cluster last failed at, and the stored diagnosis notifies
 * like one Piwi produced. The write itself is the shared handler.
 */
import { eq } from 'drizzle-orm';
import { failureClusters, testRuns } from '../database/schema';
import type { AgentDiagnosisInput } from '#shared/agent-diagnosis';
import type { HandbackActor } from '#shared/handback-outcomes';
import { recordAgentDiagnosis, type RecordAgentDiagnosisResult } from '#shared/handlers/agent-diagnosis';
import { isDiagnosisRunning } from './ai-diagnosis';
import { createScmProvider } from './scm';
import { normalizeGitUrl } from './scm/git-url';
import { emitNotification } from './notifications/emit';
import type { RunMetadata } from './run-json-types';
import type { DbClient } from '../database';

/** Read the files a patch names at the commit the cluster last failed at; null without SCM. */
async function loadClusterSources(
  db: DbClient,
  clusterId: number,
  paths: string[],
): Promise<Map<string, string> | null> {
  const [row] = await db
    .select({ projectId: failureClusters.projectId, metadata: testRuns.metadata })
    .from(failureClusters)
    .innerJoin(testRuns, eq(testRuns.id, failureClusters.lastSeenRunId))
    .where(eq(failureClusters.id, clusterId));
  const scm = (row?.metadata as RunMetadata | null)?.scm;
  const repositoryUrl = normalizeGitUrl(scm?.remoteUrl ?? null);
  if (!row || !repositoryUrl || !scm?.commit) return null;
  const provider = await createScmProvider(repositoryUrl, db, row.projectId);
  if (!provider) return null;
  const files = new Map<string, string>();
  for (const path of paths) {
    const file = await provider.fetchFileAtRef(path, scm.commit).catch(() => null);
    if (file && !file.truncated) files.set(path, file.content);
  }
  return files;
}

/** Record an agent's diagnosis on a cluster and send `diagnosis.completed`. */
export async function recordAgentDiagnosisOnCluster(
  db: DbClient,
  clusterId: number,
  input: AgentDiagnosisInput,
  actor: HandbackActor,
): Promise<RecordAgentDiagnosisResult> {
  if (isDiagnosisRunning(clusterId)) return { ok: false, error: 'running' };
  const result = await recordAgentDiagnosis(db, clusterId, input, {
    actor,
    loadSources: (id, paths) => loadClusterSources(db, id, paths),
  });
  if (result.ok) {
    emitNotification(db, 'diagnosis.completed', {
      clusterId,
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
