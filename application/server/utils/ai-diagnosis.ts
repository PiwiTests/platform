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
import { reconcileNewClusters } from './cluster-reconcile';
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

/**
 * High-signal sections included in the lean projection sent to the research
 * model. The heavy sections (full test source, console, network, ARIA, SCM
 * patches) are deliberately excluded — the research stage only narrows the
 * search, so it gets a cheap summary view while the final stage sees everything.
 */
const CORE_RESEARCH_SECTIONS = new Set([
  'clusterSummary',
  'sampleError',
  'executionError',
  'runContext',
  'recurrenceFlakiness',
  'retryProgression',
  'baselineComparison',
  'browserDistribution',
  'failingSteps',
  'testAnnotations',
  'priorDiagnosis',
]);
const RESEARCH_PROJECTION_CAP = 8000;

const SCM_GAP_RE = /\b(scm|commit|diff|regression|changed files?|git|bisect|last green|since .*green)\b/i;

/** Whether the research stage's findings warrant fetching the SCM diff. */
function researchWantsScm(research: { dataGaps: string[]; notes: string }): boolean {
  return research.dataGaps.some((g) => SCM_GAP_RE.test(g)) || SCM_GAP_RE.test(research.notes);
}

/** Build the compact, token-cheap context the research stage analyzes. */
function buildResearchProjection(ctx: { sections: Array<{ id: string; markdown: string }> }): string {
  const presentIds = [...new Set(ctx.sections.map((s) => s.id))];
  const core = ctx.sections.filter((s) => CORE_RESEARCH_SECTIONS.has(s.id));
  const scmHint = presentIds.includes('scmInvestigation')
    ? ''
    : '\nThe SCM diff (changes since the last green run) has NOT been fetched yet — include "scmInvestigation" in dataGaps if you suspect a regression and it should be pulled in for the final diagnosis.';
  const head =
    `Sections available in the full context: ${presentIds.join(', ')}.\n` +
    '(This research view includes only the high-signal summary sections; the senior engineer sees the rest.)' +
    scmHint;
  let text = [head, ...core.map((s) => s.markdown)].filter(Boolean).join('\n\n');
  if (text.length > RESEARCH_PROJECTION_CAP) {
    text = text.slice(0, RESEARCH_PROJECTION_CAP) + '\n[... research view truncated ...]';
  }
  return text;
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
    const buildCtx = (skipScm: boolean) =>
      isExecutionScope
        ? buildDiagnosisContext(db, {
            kind: 'execution',
            clusterId: cluster.id,
            testRunsCaseId: opts!.testRunsCaseId!,
            baseCommit: opts?.baseCommit,
            selectedCommitShas: opts?.selectedCommitShas,
            skipScm,
          })
        : buildDiagnosisContext(db, {
            kind: 'cluster',
            clusterId: cluster.id,
            baseCommit: opts?.baseCommit,
            selectedCommitShas: opts?.selectedCommitShas,
            skipScm,
          });

    type PipelineStage = { role: string; model: string; inputTokens: number | null; outputTokens: number | null };
    const pipeline: PipelineStage[] = [];

    // The research stage runs only when a distinct research role is configured
    // (its own provider/key/baseUrl/model, resolved in resolveAiConfig).
    const researchConfig = config.roles.research;
    const useResearch =
      researchConfig != null &&
      !(
        researchConfig.provider === config.provider &&
        researchConfig.model === config.model &&
        (researchConfig.baseUrl ?? null) === (config.baseUrl ?? null)
      );

    // The user may have pinned a baseline/commits — always fetch SCM then.
    const manualScm = Boolean(opts?.baseCommit || opts?.selectedCommitShas?.length);

    // Two-stage pipeline: the research model pre-analyzes a lean, SCM-free
    // projection of the context. Its hints are folded into the final prompt, and
    // — targeted expansion — the expensive SCM diff is only fetched when the
    // research flags it (or the user pinned commits). A research failure is
    // non-fatal: we fall back to single-stage with SCM included.
    let ctx = await buildCtx(useResearch);
    let researchBlock = '';
    if (useResearch) {
      try {
        const research = await callAiProvider(researchConfig!, {
          system: RESEARCH_SYSTEM_PROMPT,
          user: buildResearchProjection(ctx),
          jsonSchema: RESEARCH_JSON_SCHEMA,
          maxTokens: 2048,
        });
        pipeline.push({
          role: 'research',
          model: research.model,
          inputTokens: research.inputTokens,
          outputTokens: research.outputTokens,
        });
        const parsed = parseResearchJson(research.text);
        researchBlock = formatResearchBlock(parsed);
        // Targeted expansion: pay for the SCM fetch only when it's warranted.
        if (researchWantsScm(parsed) || manualScm) {
          ctx = await buildCtx(false);
        }
      } catch (e) {
        console.error('[ai-diagnosis] research stage failed, falling back to single-stage:', e);
        ctx = await buildCtx(false);
      }
    }

    const extra = opts?.additionalContext?.trim();
    const baseContent = extra ? `${ctx.text}\n\n## Additional Context Provided by User\n${extra}` : ctx.text;
    const userContent = researchBlock ? `${baseContent}\n\n${researchBlock}` : baseContent;
    // Merge auto-resolved screenshots (D1) with user-provided images
    const allImages = [...(ctx.images ?? []), ...(opts?.images ?? [])];
    const images = allImages.length > 0 ? allImages : undefined;

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

  // Always-on (when an embedding role is configured): collapse semantic
  // near-duplicate clusters from this run before any diagnosis runs, so we don't
  // diagnose a cluster that's about to be merged away. Independent of autoDiagnose.
  if (config?.roles.embedding) {
    try {
      const { embedded, merged } = await reconcileNewClusters(db, projectId, runId, config.roles.embedding);
      if (merged > 0) console.log(`[cluster-reconcile] run ${runId}: embedded ${embedded}, merged ${merged}`);
    } catch (e) {
      console.error('[cluster-reconcile] failed for run', runId, e);
    }
  }

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
