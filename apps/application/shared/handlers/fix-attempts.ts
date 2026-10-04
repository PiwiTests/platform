/**
 * Fix attempts reported on a failure cluster, stored as `fix-attempt` outcome
 * rows: `applied` when reported, then `verified` or `regressed` from the runs
 * (`server/utils/fix-attempts.ts`). Shared by the REST route, the MCP tool and
 * the demo.
 */
import { and, eq } from 'drizzle-orm';
import { failureClusters, failureDiagnoses } from '../../server/database/schema';
import { listOutcomes, recordOutcome } from '../../server/utils/outcomes';
import type { HandbackActor, HandbackOutcome } from '../handback-outcomes';
import { fixAttemptDetails, fixAttemptKey, type FixAttemptDetails, type ReportFixAttemptBody } from '../fix-attempts';
import type { DrizzleDB } from './db';

/** One attempt on a cluster, with the latest outcome the runs gave it. */
export interface FixAttempt {
  key: string;
  details: FixAttemptDetails;
  /** `applied` until a fix lands with it; then `verified`, or `regressed` once the cluster fails again. */
  outcome: HandbackOutcome;
  channel: string;
  actorUserId: number | null;
  actorApiKeyId: number | null;
  reportedAt: Date;
  /** When the latest outcome was recorded, and the run that gave it. */
  outcomeAt: Date;
  runId: number | null;
}

export type ReportFixAttemptResult =
  | { ok: true; attempt: FixAttempt; recorded: boolean; projectId: number }
  | { ok: false; error: 'not-found' | 'diagnosis-mismatch' };

/** Every attempt reported on one cluster, oldest first, each with its latest outcome. */
export async function listFixAttempts(db: DrizzleDB, clusterId: number): Promise<FixAttempt[]> {
  const rows = await listOutcomes(db, { kind: 'fix-attempt', subjectType: 'cluster', subjectIds: [clusterId] });
  const byKey = new Map<string, FixAttempt>();
  for (const row of rows) {
    const existing = byKey.get(row.suggestionKey);
    if (!existing) {
      if (row.outcome !== 'applied') continue;
      byKey.set(row.suggestionKey, {
        key: row.suggestionKey,
        details: row.details as unknown as FixAttemptDetails,
        outcome: 'applied',
        channel: row.channel,
        actorUserId: row.actorUserId,
        actorApiKeyId: row.actorApiKeyId,
        reportedAt: row.createdAt,
        outcomeAt: row.createdAt,
        runId: null,
      });
      continue;
    }
    existing.outcome = row.outcome;
    existing.outcomeAt = row.createdAt;
    existing.runId = row.runId;
    const link = (row.details as { link?: FixAttemptDetails['link'] } | null)?.link;
    if (link) existing.details = { ...existing.details, link };
  }
  return [...byKey.values()];
}

/** Record a reported attempt as `applied`. Reporting the same change again records nothing new. */
export async function reportFixAttempt(
  db: DrizzleDB,
  clusterId: number,
  body: ReportFixAttemptBody,
  actor: HandbackActor,
): Promise<ReportFixAttemptResult> {
  const [cluster] = await db
    .select({ id: failureClusters.id, projectId: failureClusters.projectId })
    .from(failureClusters)
    .where(eq(failureClusters.id, clusterId));
  if (!cluster) return { ok: false, error: 'not-found' };
  if (body.diagnosisId != null) {
    const [diagnosis] = await db
      .select({ id: failureDiagnoses.id })
      .from(failureDiagnoses)
      .where(and(eq(failureDiagnoses.id, body.diagnosisId), eq(failureDiagnoses.clusterId, clusterId)));
    if (!diagnosis) return { ok: false, error: 'diagnosis-mismatch' };
  }

  const details = fixAttemptDetails(body);
  const key = fixAttemptKey(details);
  const recorded = await recordOutcome(db, {
    projectId: cluster.projectId,
    kind: 'fix-attempt',
    subjectType: 'cluster',
    subjectId: clusterId,
    suggestionKey: key,
    outcome: 'applied',
    actor,
    commit: details.commit,
    details: details as unknown as Record<string, unknown>,
  });
  const attempt = (await listFixAttempts(db, clusterId)).find((a) => a.key === key)!;
  return { ok: true, attempt, recorded, projectId: cluster.projectId };
}

/** The message and HTTP status of each refusal of {@link reportFixAttempt}. */
export const FIX_ATTEMPT_ERRORS = {
  'not-found': { status: 404, message: 'Failure cluster not found' },
  'diagnosis-mismatch': { status: 400, message: 'diagnosisId is not a diagnosis of this cluster' },
} as const;
