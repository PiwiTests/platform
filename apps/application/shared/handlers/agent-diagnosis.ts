/**
 * Recording a diagnosis an agent wrote on a failure cluster.
 *
 * The diagnosis takes the cluster's diagnosis row like a model's would: the
 * current row is snapshotted into the versions first, so its rating stays on
 * the version it rated, and the new one starts unrated. The row carries the
 * provider `agent` and the model the agent named. It is not gated by the `ai`
 * capability, which governs Piwi calling a model; an instance or project that
 * declined `agent-diagnoses` refuses it.
 *
 * Shared by the REST route, the MCP tool and the demo. The server passes a
 * loader for the source files the patch touches so the patch is validated
 * against the code that failed; without one the patch is checked for shape only.
 */
import { and, eq } from 'drizzle-orm';
import { failureClusters, failureDiagnoses, failureDiagnosisVersions } from '../../server/database/schema';
import { AGENT_DIAGNOSIS_PROVIDER, type AgentDiagnosisInput } from '#shared/agent-diagnosis';
import type { HandbackActor } from '#shared/handback-outcomes';
import { parseUnifiedDiff, stripAbPrefix, validatePatch, type PatchValidation } from '#shared/patch';
import { buildDiagnosisVersionValues } from './diagnosis-versions';
import { isPassiveCapabilityDeclined } from './capabilities';
import type { DrizzleDB } from './db';

/** A diagnosis row still `running` and touched within this window belongs to a diagnosis in flight. */
const RUNNING_FRESH_MS = 5 * 60 * 1000;

/** Files of a patch the loader is asked for, at most. */
export const MAX_PATCH_FILES_CHECKED = 10;

/** Reads the source files a patch names, at the commit the cluster last failed at. */
export type PatchSourceLoader = (clusterId: number, paths: string[]) => Promise<Map<string, string> | null>;

export type RecordAgentDiagnosisResult =
  | {
      ok: true;
      diagnosisId: number;
      projectId: number;
      patchValidation: PatchValidation | null;
      replacedVersion: boolean;
    }
  | { ok: false; error: 'not-found' | 'declined' | 'running' };

/** The repo-relative files a unified diff changes. */
export function patchTargetFiles(patch: string): string[] {
  const files = new Set<string>();
  for (const file of parseUnifiedDiff(patch).files) {
    const path = stripAbPrefix(file.newPath) ?? stripAbPrefix(file.oldPath);
    if (path) files.add(path);
  }
  return [...files];
}

/** Validate an agent's patch against the files the loader returns; null when there is no patch. */
export async function validateAgentPatch(
  clusterId: number,
  patch: string | null,
  loadSources?: PatchSourceLoader,
): Promise<PatchValidation | null> {
  if (!patch?.trim()) return null;
  let sources: Map<string, string> | null = null;
  if (loadSources) {
    const paths = patchTargetFiles(patch).slice(0, MAX_PATCH_FILES_CHECKED);
    sources = paths.length ? await loadSources(clusterId, paths).catch(() => null) : null;
  }
  return validatePatch(patch, sources ?? new Map());
}

/** Record an agent's diagnosis on a cluster, replacing the current one after snapshotting it. */
export async function recordAgentDiagnosis(
  db: DrizzleDB,
  clusterId: number,
  input: AgentDiagnosisInput,
  opts: { actor: HandbackActor; loadSources?: PatchSourceLoader; now?: Date },
): Promise<RecordAgentDiagnosisResult> {
  const [cluster] = await db
    .select({ id: failureClusters.id, projectId: failureClusters.projectId })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return { ok: false, error: 'not-found' };
  if (await isPassiveCapabilityDeclined(db, cluster.projectId, 'agent-diagnoses')) {
    return { ok: false, error: 'declined' };
  }

  const now = opts.now ?? new Date();
  const where = and(eq(failureDiagnoses.clusterId, clusterId), eq(failureDiagnoses.scope, 'cluster'));
  const [existing] = await db.select().from(failureDiagnoses).where(where).limit(1);
  if (existing?.status === 'running') {
    const touched = new Date(existing.updatedAt as Date | number | string).getTime();
    if (now.getTime() - touched < RUNNING_FRESH_MS) return { ok: false, error: 'running' };
  }

  const { diagnosis, model } = input;
  const patchValidation = await validateAgentPatch(clusterId, diagnosis.suggestedFix.patch, opts.loadSources);
  const values = {
    status: 'completed',
    provider: AGENT_DIAGNOSIS_PROVIDER,
    model,
    contextSha: null,
    category: diagnosis.category,
    confidence: diagnosis.confidence,
    summary: diagnosis.summary,
    rootCause: diagnosis.rootCause,
    details: {
      evidence: diagnosis.evidence,
      suggestedFix: { ...diagnosis.suggestedFix, patchValidation },
      preventionTips: diagnosis.preventionTips,
      confidenceScore: diagnosis.confidenceScore,
      severity: diagnosis.severity,
      affectedArea: diagnosis.affectedArea,
      hypotheses: diagnosis.hypotheses,
      investigationSteps: diagnosis.investigationSteps,
      recordedBy: {
        channel: opts.actor.channel,
        userId: opts.actor.userId || null,
        apiKeyId: opts.actor.apiKeyId || null,
      },
    },
    error: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
    feedback: null,
    feedbackNote: null,
    createdAt: now,
    updatedAt: now,
  };

  if (existing) {
    await db.insert(failureDiagnosisVersions).values(buildDiagnosisVersionValues(existing, now));
    await db.update(failureDiagnoses).set(values).where(eq(failureDiagnoses.id, existing.id));
    return { ok: true, diagnosisId: existing.id, projectId: cluster.projectId, patchValidation, replacedVersion: true };
  }
  const [inserted] = await db
    .insert(failureDiagnoses)
    .values({ clusterId, scope: 'cluster', ...values })
    .returning({ id: failureDiagnoses.id });
  return { ok: true, diagnosisId: inserted!.id, projectId: cluster.projectId, patchValidation, replacedVersion: false };
}
