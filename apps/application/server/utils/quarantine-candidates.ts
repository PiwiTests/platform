/**
 * Quarantine proposals.
 *
 * A quarantine list nobody maintains is a list nobody trusts, so the candidates
 * are derived rather than remembered: the flaky analysis already scores every
 * intermittent test and prices it in wasted CI minutes, and the tests worth
 * quarantining are simply the expensive end of that list.
 *
 * Ranking by wasted CI time rather than by flakiness score is deliberate. A
 * test that flakes constantly but finishes in 200ms costs nothing; one that
 * flakes weekly and burns a four-minute timeout each time is what actually
 * hurts the pipeline.
 *
 * A completed AI diagnosis of one of the test's failures that calls it a flaky
 * test with high confidence, and that nobody rated unhelpful, is one more
 * reason on the candidate.
 */
import { and, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { failureDiagnoses, testRunsCases } from '../database/schema';
import { getProjectFlakyTests } from '#shared/handlers/projects';
import type { DbClient } from '../database';

/** Below this, quarantining costs more attention than it saves. */
const MIN_WASTED_CI_MINUTES = 2;
const MIN_FLAKY_SCORE = 40;
const MAX_CANDIDATES = 10;

export interface QuarantineCandidate {
  testCaseId: number;
  title: string;
  filePath: string;
  flakyScore: number;
  wastedCiMinutes: number;
  rootCause: string | null;
  owner: string | null;
  /** Each reason this test is proposed, one sentence each. */
  reasons: string[];
  /** The reasons joined, ready to store as the quarantine reason. */
  rationale: string;
  /** The high-confidence flaky-test diagnosis behind one of the reasons, when there is one. */
  diagnosis: { clusterId: number | null; summary: string | null; model: string | null } | null;
}

interface FlakyDiagnosis {
  clusterId: number | null;
  summary: string | null;
  model: string | null;
}

/**
 * Per test, the newest completed diagnosis of one of its failures (its
 * cluster's, or one of its executions') that names a flaky test with high
 * confidence and is not rated unhelpful.
 */
export async function flakyDiagnosesByTest(db: DbClient, testCaseIds: number[]): Promise<Map<number, FlakyDiagnosis>> {
  const out = new Map<number, FlakyDiagnosis>();
  if (testCaseIds.length === 0) return out;
  const rows = await db
    .select({
      testCaseId: testRunsCases.testCaseId,
      clusterId: failureDiagnoses.clusterId,
      summary: failureDiagnoses.summary,
      model: failureDiagnoses.model,
    })
    .from(failureDiagnoses)
    .innerJoin(
      testRunsCases,
      or(
        eq(failureDiagnoses.testRunsCaseId, testRunsCases.id),
        and(eq(failureDiagnoses.scope, 'cluster'), eq(failureDiagnoses.clusterId, testRunsCases.failureClusterId)),
      ),
    )
    .where(
      and(
        inArray(testRunsCases.testCaseId, testCaseIds),
        eq(failureDiagnoses.status, 'completed'),
        eq(failureDiagnoses.category, 'flaky-test'),
        eq(failureDiagnoses.confidence, 'high'),
        or(isNull(failureDiagnoses.feedback), eq(failureDiagnoses.feedback, 'up')),
      ),
    )
    .orderBy(desc(failureDiagnoses.updatedAt));
  for (const row of rows) {
    if (!out.has(row.testCaseId)) {
      out.set(row.testCaseId, { clusterId: row.clusterId ?? null, summary: row.summary ?? null, model: row.model });
    }
  }
  return out;
}

/** The sentence a flaky-test diagnosis adds to a candidate's reasons. */
export function diagnosisReason(diagnosis: FlakyDiagnosis): string {
  return diagnosis.summary
    ? `AI diagnosis, high confidence: a flaky test (${diagnosis.summary})`
    : 'AI diagnosis, high confidence: a flaky test';
}

/**
 * Tests worth quarantining, excluding those already quarantined. Returns an
 * empty list when the project has no flaky history — proposing nothing is the
 * correct answer for a healthy suite.
 */
export async function proposeQuarantineCandidates(
  db: DbClient,
  projectId: number,
  alreadyQuarantined: Set<number>,
): Promise<QuarantineCandidate[]> {
  let flaky: any[] = [];
  try {
    flaky = (await getProjectFlakyTests(db, projectId, 50)) as any[];
  } catch {
    return [];
  }

  const chosen = flaky
    .filter(
      (test) =>
        !alreadyQuarantined.has(test.testCaseId) &&
        (test.wastedCiMinutes ?? 0) >= MIN_WASTED_CI_MINUTES &&
        (test.score ?? 0) >= MIN_FLAKY_SCORE,
    )
    .slice(0, MAX_CANDIDATES);
  const diagnoses = await flakyDiagnosesByTest(
    db,
    chosen.map((test) => test.testCaseId),
  );

  return chosen.map((test) => {
    const diagnosis = diagnoses.get(test.testCaseId) ?? null;
    const reasons = [
      `Flaky score ${test.score}, wasting ~${(test.wastedCiMinutes ?? 0).toFixed(1)} CI minutes${
        test.rootCause ? ` (${test.rootCause})` : ''
      }`,
    ];
    if (diagnosis) reasons.push(diagnosisReason(diagnosis));
    return {
      testCaseId: test.testCaseId,
      title: test.title,
      filePath: test.filePath,
      flakyScore: test.score,
      wastedCiMinutes: test.wastedCiMinutes ?? 0,
      rootCause: test.rootCause ?? null,
      owner: test.owner ?? null,
      reasons,
      rationale: reasons.join('; '),
      diagnosis,
    };
  });
}
