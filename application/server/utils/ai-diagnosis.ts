import { eq, and } from 'drizzle-orm';
import {
  failureDiagnoses,
  failureDiagnosisVersions,
  failureClusters,
  projects,
  testRunsCases,
} from '../database/schema';
import type { FailureDiagnosis, FailureCluster } from '../database/schema';
import { DIAGNOSIS_JSON_SCHEMA, parseDiagnosisJson } from '#shared/ai-diagnosis';
import type { AiConfig } from '~~/types/api';
import { callAiProvider, resolveAiConfig } from './ai-provider';
import type { AiAttachedImage } from './ai-provider';
import { buildDiagnosisContext } from './ai-context';
import { buildDiagnosisSystemPrompt } from './ai-system-prompt';
import { RESEARCH_SYSTEM_PROMPT, RESEARCH_JSON_SCHEMA, parseResearchJson, formatResearchBlock } from './ai-research';

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
    /** When set, scope is 'execution' and the diagnosis is for a specific test-run-case. */
    testRunsCaseId?: number;
  },
): Promise<FailureDiagnosis> {
  if (running.has(cluster.id)) {
    throw Object.assign(new Error('Diagnosis already running for this cluster'), { statusCode: 409 });
  }

  running.add(cluster.id);

  const isExecutionScope = Boolean(opts?.testRunsCaseId);

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

  // Upsert to 'running' state (SELECT-then-INSERT/UPDATE to avoid unique-index dependency)
  const runningFields = runningDiagnosisFields(config);
  const scope = isExecutionScope ? ('execution' as const) : ('cluster' as const);

  if (isExecutionScope) {
    const [existing] = await db
      .select({ id: failureDiagnoses.id })
      .from(failureDiagnoses)
      .where(and(eq(failureDiagnoses.testRunsCaseId, opts!.testRunsCaseId!), eq(failureDiagnoses.scope, 'execution')))
      .limit(1);
    if (existing) {
      await snapshotDiagnosis(db, existing.id);
      await db.update(failureDiagnoses).set(runningFields).where(eq(failureDiagnoses.id, existing.id));
    } else {
      await db.insert(failureDiagnoses).values({
        clusterId: cluster.id,
        scope: 'execution',
        testRunsCaseId: opts!.testRunsCaseId!,
        createdAt: new Date(),
        ...runningFields,
      });
    }
  } else {
    const [existing] = await db
      .select({ id: failureDiagnoses.id })
      .from(failureDiagnoses)
      .where(and(eq(failureDiagnoses.clusterId, cluster.id), eq(failureDiagnoses.scope, 'cluster')))
      .limit(1);
    if (existing) {
      await snapshotDiagnosis(db, existing.id);
      await db.update(failureDiagnoses).set(runningFields).where(eq(failureDiagnoses.id, existing.id));
    } else {
      await db.insert(failureDiagnoses).values({
        clusterId: cluster.id,
        scope: 'cluster',
        createdAt: new Date(),
        ...runningFields,
      });
    }
  }

  const t0 = Date.now();

  try {
    const ctx = isExecutionScope
      ? await buildDiagnosisContext(db, {
          kind: 'execution',
          clusterId: cluster.id,
          testRunsCaseId: opts!.testRunsCaseId!,
          baseCommit: opts?.baseCommit,
          selectedCommitShas: opts?.selectedCommitShas,
        })
      : await buildDiagnosisContext(db, {
          kind: 'cluster',
          clusterId: cluster.id,
          baseCommit: opts?.baseCommit,
          selectedCommitShas: opts?.selectedCommitShas,
        });
    const extra = opts?.additionalContext?.trim();
    const baseContent = extra ? `${ctx.text}\n\n## Additional Context Provided by User\n${extra}` : ctx.text;
    // Merge auto-resolved screenshots (D1) with user-provided images
    const allImages = [...(ctx.images ?? []), ...(opts?.images ?? [])];
    const images = allImages.length > 0 ? allImages : undefined;

    type PipelineStage = { role: string; model: string; inputTokens: number | null; outputTokens: number | null };
    const pipeline: PipelineStage[] = [];

    // Two-stage pipeline: an optional cheaper "research" model pre-analyzes the
    // failure, and its hints are folded into the final diagnosis prompt. A
    // research failure is non-fatal — we fall back to single-stage.
    let userContent = baseContent;
    const researchModel = config.researchModel?.trim();
    if (researchModel && researchModel !== config.model) {
      try {
        const research = await callAiProvider(
          { ...config, model: researchModel },
          {
            system: RESEARCH_SYSTEM_PROMPT,
            user: baseContent,
            jsonSchema: RESEARCH_JSON_SCHEMA,
            images,
            maxTokens: 2048,
          },
        );
        pipeline.push({
          role: 'research',
          model: research.model,
          inputTokens: research.inputTokens,
          outputTokens: research.outputTokens,
        });
        const block = formatResearchBlock(parseResearchJson(research.text));
        if (block) userContent = `${baseContent}\n\n${block}`;
      } catch (e) {
        console.error('[ai-diagnosis] research stage failed, falling back to single-stage:', e);
      }
    }

    const result = await callAiProvider(config, {
      system: systemPrompt,
      user: userContent,
      jsonSchema: DIAGNOSIS_JSON_SCHEMA,
      images,
    });
    pipeline.push({
      role: 'diagnosis',
      model: result.model,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
    });
    const diagnosis = parseDiagnosisJson(result.text);

    const sumTokens = (k: 'inputTokens' | 'outputTokens') => pipeline.reduce((acc, s) => acc + (s[k] ?? 0), 0) || null;

    const whereClause = isExecutionScope
      ? and(eq(failureDiagnoses.testRunsCaseId, opts!.testRunsCaseId!), eq(failureDiagnoses.scope, 'execution'))
      : and(eq(failureDiagnoses.clusterId, cluster.id), eq(failureDiagnoses.scope, 'cluster'));

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
          confidenceScore: diagnosis.confidenceScore,
          severity: diagnosis.severity,
          affectedArea: diagnosis.affectedArea,
          hypotheses: diagnosis.hypotheses,
          investigationSteps: diagnosis.investigationSteps,
          ...(pipeline.length > 1 ? { pipeline } : {}),
        },
        error: null,
        inputTokens: sumTokens('inputTokens'),
        outputTokens: sumTokens('outputTokens'),
        durationMs: Date.now() - t0,
        updatedAt: new Date(),
      })
      .where(whereClause)
      .returning();

    return updated[0]!;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const whereClause = isExecutionScope
      ? and(eq(failureDiagnoses.testRunsCaseId, opts!.testRunsCaseId!), eq(failureDiagnoses.scope, 'execution'))
      : and(eq(failureDiagnoses.clusterId, cluster.id), eq(failureDiagnoses.scope, 'cluster'));

    const failed = await db
      .update(failureDiagnoses)
      .set({
        status: 'failed',
        error: message.slice(0, 500),
        durationMs: Date.now() - t0,
        updatedAt: new Date(),
      })
      .where(whereClause)
      .returning();

    return failed[0]!;
  } finally {
    running.delete(cluster.id);
  }
}

/**
 * Snapshot the current state of a diagnosis row into `failure_diagnosis_versions`
 * before it gets overwritten by a re-diagnose.
 */
async function snapshotDiagnosis(db: DbClient, diagnosisId: number): Promise<void> {
  const [row] = await db.select().from(failureDiagnoses).where(eq(failureDiagnoses.id, diagnosisId)).limit(1);
  if (!row) return;
  const fields = {
    diagnosisId: row.id,
    clusterId: row.clusterId,
    scope: row.scope,
    testRunsCaseId: row.testRunsCaseId,
    status: row.status,
    provider: row.provider,
    model: row.model,
    category: row.category,
    confidence: row.confidence,
    summary: row.summary,
    rootCause: row.rootCause,
    details: row.details as Record<string, unknown> | null,
    error: row.error,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    durationMs: row.durationMs,
    contextSha: row.contextSha,
    createdAt: new Date(),
  };
  await db.insert(failureDiagnosisVersions).values(fields);
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
