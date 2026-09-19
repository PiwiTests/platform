/**
 * Detector precision from triage verdicts — the learning loop. Every triage is a
 * labeled example: accepted and covered-by count for the detector, dismissed-as-
 * wrong counts against. A detector below the threshold on a project with enough
 * verdicts mutes itself there: its rows drop out of the pull-request comment
 * first, and the Gaps tab says so.
 *
 * The scoring core is pure so the demo and the tests run it; the loader reads the
 * gaps and the manual reaches edges a covered-by wrote.
 */

import { and, eq, isNull } from 'drizzle-orm';
import { graphEdges, scenarioGaps } from '../../server/database/schema';
import { subjectFromGapKey } from './scenario-gaps';
import type { DrizzleDB } from './db';

/** A detector mutes itself below this precision, once it has enough verdicts. */
export const MUTE_PRECISION_THRESHOLD = 0.6;
export const MUTE_MIN_VERDICTS = 20;

/** One triage verdict for a detector: it was right (`for`) or wrong (`against`). */
export interface DetectorVerdict {
  detector: string;
  verdict: 'for' | 'against';
}

/** A detector's precision on a project, and whether it has muted itself. */
export interface DetectorPrecision {
  detector: string;
  for: number;
  against: number;
  verdicts: number;
  /** for / (for + against), or null when there are no verdicts. */
  precision: number | null;
  muted: boolean;
}

/** True when a detector's precision is low enough, with enough verdicts, to mute. */
export function isDetectorMuted(precision: number | null, verdicts: number): boolean {
  return precision != null && verdicts >= MUTE_MIN_VERDICTS && precision < MUTE_PRECISION_THRESHOLD;
}

/**
 * Fold triage verdicts into per-detector precision. Pure: the loader turns gap
 * rows and covered-by edges into the verdict list this scores.
 */
export function computeDetectorPrecision(verdicts: DetectorVerdict[]): DetectorPrecision[] {
  const byDetector = new Map<string, { for: number; against: number }>();
  for (const v of verdicts) {
    const entry = byDetector.get(v.detector) ?? { for: 0, against: 0 };
    if (v.verdict === 'for') entry.for++;
    else entry.against++;
    byDetector.set(v.detector, entry);
  }
  return [...byDetector.entries()]
    .map(([detector, { for: forCount, against }]) => {
      const total = forCount + against;
      const precision = total > 0 ? forCount / total : null;
      return { detector, for: forCount, against, verdicts: total, precision, muted: isDetectorMuted(precision, total) };
    })
    .sort((a, b) => (a.precision ?? 1) - (b.precision ?? 1));
}

/**
 * Load a project's per-detector precision from its triage verdicts: accepted
 * gaps and covered-by gaps (a manual reaches edge into the subject, not
 * dismissed) count for; dismissed-as-wrong counts against.
 */
export async function loadDetectorPrecision(db: DrizzleDB, projectId: number): Promise<DetectorPrecision[]> {
  const rows = await db
    .select({
      detector: scenarioGaps.detector,
      key: scenarioGaps.key,
      status: scenarioGaps.status,
      dismissReason: scenarioGaps.dismissReason,
    })
    .from(scenarioGaps)
    .where(eq(scenarioGaps.projectId, projectId));

  // Subjects a covered-by manual reaches edge points at — the covered-by "for" signal.
  const manualEdges = await db
    .select({ toKind: graphEdges.toKind, toKey: graphEdges.toKey })
    .from(graphEdges)
    .where(
      and(
        eq(graphEdges.projectId, projectId),
        eq(graphEdges.kind, 'reaches'),
        eq(graphEdges.origin, 'manual'),
        isNull(graphEdges.branch),
      ),
    );
  const coveredNodes = new Set(manualEdges.map((e) => `${e.toKind}\x00${e.toKey}`));

  const verdicts: DetectorVerdict[] = [];
  for (const r of rows) {
    if (r.status === 'accepted') {
      verdicts.push({ detector: r.detector, verdict: 'for' });
    } else if (r.status === 'dismissed' && r.dismissReason === 'wrong') {
      verdicts.push({ detector: r.detector, verdict: 'against' });
    } else if (r.status !== 'dismissed') {
      const subject = subjectFromGapKey(r.key);
      if (coveredNodes.has(`${subject.kind}\x00${subject.key}`)) {
        verdicts.push({ detector: r.detector, verdict: 'for' });
      }
    }
  }
  return computeDetectorPrecision(verdicts);
}

/** The set of detectors muted on a project — read by the PR comment and the tab. */
export async function loadMutedDetectors(db: DrizzleDB, projectId: number): Promise<Set<string>> {
  const precision = await loadDetectorPrecision(db, projectId);
  return new Set(precision.filter((p) => p.muted).map((p) => p.detector));
}
