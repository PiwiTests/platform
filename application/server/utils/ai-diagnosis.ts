import { eq, and } from 'drizzle-orm';
import { failureDiagnoses, failureClusters, projects } from '../database/schema';
import type { FailureDiagnosis, FailureCluster } from '../database/schema';
import { DIAGNOSIS_JSON_SCHEMA, parseDiagnosisJson } from '#shared/ai-diagnosis';
import type { AiConfig } from '~~/types/api';
import { callAiProvider, resolveAiConfig } from './ai-provider';
import type { AiAttachedImage } from './ai-provider';
import { buildClusterDiagnosisContext } from './ai-context';
import { buildDiagnosisSystemPrompt } from './ai-system-prompt';

type DbClient = Awaited<ReturnType<typeof import('../database').getDatabase>>;

const STALE_RUNNING_MS = 5 * 60 * 1000;

// Concurrency guard: prevent double-running for the same cluster
const running = new Set<number>();

export function isDiagnosisRunning(clusterId: number): boolean {
  return running.has(clusterId);
}

export function isDiagnosisStale(row: FailureDiagnosis): boolean {
  if (row.status !== 'running') return false;
  return Date.now() - row.updatedAt.getTime() > STALE_RUNNING_MS;
}

/** Default model when none is configured (Anthropic only; OpenAI requires an explicit model). */
function resolveModel(config: AiConfig): string {
  return config.model || (config.provider === 'anthropic' ? 'claude-opus-4-8' : config.model);
}

/** Column values that reset a diagnosis row to the 'running' state (shared by insert + update). */
function runningDiagnosisFields(config: AiConfig) {
  return {
    status: 'running' as const,
    provider: config.provider,
    model: resolveModel(config),
    category: null,
    confidence: null,
    summary: null,
    rootCause: null,
    details: null,
    error: null,
    inputTokens: null,
    outputTokens: null,
    durationMs: null,
    updatedAt: new Date(),
  };
}

export async function runClusterDiagnosis(
  db: DbClient,
  cluster: FailureCluster,
  config: AiConfig,
  opts?: {
    force?: boolean;
    additionalContext?: string;
    images?: AiAttachedImage[];
    baseCommit?: string;
    selectedCommitShas?: string[];
  },
): Promise<FailureDiagnosis> {
  if (running.has(cluster.id)) {
    throw Object.assign(new Error('Diagnosis already running for this cluster'), { statusCode: 409 });
  }

  running.add(cluster.id);

  // Load custom instructions (global + project) to build the combined system prompt
  const [globalInstructionsRow, projectRows] = await Promise.all([
    getAppSetting<{ value?: string }>(db, 'ai_instructions'),
    db
      .select({ diagnosisInstructions: projects.diagnosisInstructions })
      .from(projects)
      .where(eq(projects.id, cluster.projectId))
      .limit(1),
  ]);
  const systemPrompt = buildDiagnosisSystemPrompt({
    globalInstructions: globalInstructionsRow?.value?.trim() || null,
    projectInstructions: projectRows[0]?.diagnosisInstructions?.trim() || null,
  });

  // Upsert to 'running' state
  const runningFields = runningDiagnosisFields(config);
  await db
    .insert(failureDiagnoses)
    .values({ clusterId: cluster.id, createdAt: new Date(), ...runningFields })
    .onConflictDoUpdate({ target: failureDiagnoses.clusterId, set: runningFields });

  const t0 = Date.now();

  try {
    const { text: userContent } = await buildClusterDiagnosisContext(db, cluster, {
      baseCommit: opts?.baseCommit,
      selectedCommitShas: opts?.selectedCommitShas,
    });
    const extra = opts?.additionalContext?.trim();
    const fullUserContent = extra ? `${userContent}\n\n## Additional Context Provided by User\n${extra}` : userContent;
    const result = await callAiProvider(config, {
      system: systemPrompt,
      user: fullUserContent,
      jsonSchema: DIAGNOSIS_JSON_SCHEMA,
      images: opts?.images,
    });
    const diagnosis = parseDiagnosisJson(result.text);

    const updated = await db
      .update(failureDiagnoses)
      .set({
        status: 'completed',
        model: result.model,
        category: diagnosis.category,
        confidence: diagnosis.confidence,
        summary: diagnosis.summary,
        rootCause: diagnosis.rootCause,
        details: {
          evidence: diagnosis.evidence,
          suggestedFix: diagnosis.suggestedFix,
          preventionTips: diagnosis.preventionTips,
        },
        error: null,
        inputTokens: result.inputTokens,
        outputTokens: result.outputTokens,
        durationMs: Date.now() - t0,
        updatedAt: new Date(),
      })
      .where(eq(failureDiagnoses.clusterId, cluster.id))
      .returning();

    return updated[0]!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const failed = await db
      .update(failureDiagnoses)
      .set({
        status: 'failed',
        error: message.slice(0, 500),
        durationMs: Date.now() - t0,
        updatedAt: new Date(),
      })
      .where(eq(failureDiagnoses.clusterId, cluster.id))
      .returning();

    return failed[0]!;
  } finally {
    running.delete(cluster.id);
  }
}

export async function autoDiagnoseRun(db: DbClient, projectId: number, runId: number): Promise<void> {
  const config = await resolveAiConfig(db);
  if (!config?.autoDiagnose) return;

  const clusters = await db
    .select()
    .from(failureClusters)
    .where(and(eq(failureClusters.projectId, projectId), eq(failureClusters.firstSeenRunId, runId)))
    .limit(3);

  for (const cluster of clusters) {
    try {
      const existingRows = await db
        .select()
        .from(failureDiagnoses)
        .where(eq(failureDiagnoses.clusterId, cluster.id))
        .limit(1);

      const existing = existingRows[0];
      if (
        existing &&
        (existing.status === 'completed' || (existing.status === 'running' && !isDiagnosisStale(existing)))
      ) {
        continue;
      }

      if (running.has(cluster.id)) continue;

      await runClusterDiagnosis(db, cluster, config);
    } catch (e) {
      console.error('[ai-diagnosis] autoDiagnose failed for cluster', cluster.id, e);
    }
  }
}
