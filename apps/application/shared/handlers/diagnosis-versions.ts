/**
 * Single source of truth for snapshotting a `failure_diagnoses` row into
 * `failure_diagnosis_versions` before it is overwritten by a re-diagnose, and for
 * reading the version history back.
 *
 * Both the server (`server/utils/ai-diagnosis.ts#snapshotDiagnosis`) and the demo
 * force-refresh path (`app/demo/api/ai.ts`) build the identical version row, so the
 * field mapping lives here to satisfy the no-duplication rule (AGENTS.md).
 */
import { eq, desc } from 'drizzle-orm';
import { failureDiagnosisVersions } from '../../server/database/schema';
import type { DrizzleDB } from './db';

/** The subset of a diagnosis row needed to snapshot a version (structurally typed). */
export interface DiagnosisRowForVersion {
  id: number;
  clusterId: number | null;
  scope: string;
  testRunsCaseId: number | null;
  status: string;
  provider: string | null;
  model: string | null;
  category: string | null;
  confidence: string | null;
  summary: string | null;
  rootCause: string | null;
  details: unknown;
  error: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  durationMs: number | null;
  contextSha?: string | null;
  feedback?: string | null;
  feedbackNote?: string | null;
}

/** Build the insert values for a `failure_diagnosis_versions` row from a diagnosis. */
export function buildDiagnosisVersionValues(row: DiagnosisRowForVersion, createdAt: Date = new Date()) {
  return {
    diagnosisId: row.id,
    clusterId: row.clusterId,
    scope: row.scope,
    testRunsCaseId: row.testRunsCaseId ?? null,
    status: row.status,
    provider: row.provider,
    model: row.model,
    category: row.category,
    confidence: row.confidence,
    summary: row.summary,
    rootCause: row.rootCause,
    details: (row.details as Record<string, unknown> | null) ?? null,
    error: row.error,
    inputTokens: row.inputTokens,
    outputTokens: row.outputTokens,
    durationMs: row.durationMs,
    contextSha: row.contextSha ?? null,
    feedback: row.feedback ?? null,
    feedbackNote: row.feedbackNote ?? null,
    createdAt,
  };
}

/** Up to this many prior versions are returned — matches the retention cap. */
const MAX_VERSIONS = 50;

/**
 * List a cluster's prior diagnosis versions, newest first. The list is light by
 * default (`what`, model, category, confidence, feedback, tokens); pass
 * `full: true` to include `details` for each so a version can be rendered in full
 * without a second call. Shared by the server endpoint and the demo mirror.
 */
export async function listDiagnosisVersions(db: DrizzleDB, clusterId: number, opts: { full?: boolean } = {}) {
  const versions = await db
    .select()
    .from(failureDiagnosisVersions)
    .where(eq(failureDiagnosisVersions.clusterId, clusterId))
    .orderBy(desc(failureDiagnosisVersions.createdAt))
    .limit(MAX_VERSIONS);

  return versions.map((v) => ({
    id: v.id,
    status: v.status,
    category: v.category,
    confidence: v.confidence,
    summary: v.summary,
    rootCause: v.rootCause,
    model: v.model,
    inputTokens: v.inputTokens,
    outputTokens: v.outputTokens,
    durationMs: v.durationMs,
    feedback: v.feedback ?? null,
    createdAt: v.createdAt,
    ...(opts.full
      ? { details: v.details, feedbackNote: v.feedbackNote ?? null, contextSha: v.contextSha ?? null }
      : {}),
  }));
}
