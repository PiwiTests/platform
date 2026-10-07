/**
 * The flake profiles the flaky list and the lab's suspects read (the summary
 * view), kept per test until a run of its project ends: a profile reads every
 * run its test ran in over its window, and each asks for up to 50 at a time. Lab runs stay out
 * of profiles, so a lab experiment never makes one stale; the lab results the
 * list shows beside them are read on each request. A deleted run is not
 * announced, so an entry also expires after ten minutes.
 */
import { TtlCache } from './ttl-cache';
import { getFlakeProfileSummaries, type FlakeProfile } from '#shared/handlers/flake-profile';
import type { DrizzleDB } from '#shared/handlers/db';

export const FLAKE_PROFILE_CACHE_TTL_MS = 10 * 60_000;

const cache = new TtlCache<{ projectId: number; profile: FlakeProfile }>(FLAKE_PROFILE_CACHE_TTL_MS, 2_000);

/** The summary profiles of tests of one project, computing only those not kept. */
export async function cachedFlakeProfileSummaries(
  db: DrizzleDB,
  projectId: number,
  testCaseIds: number[],
): Promise<FlakeProfile[]> {
  const kept = new Map<number, FlakeProfile>();
  for (const id of testCaseIds) {
    const entry = cache.get(String(id));
    if (entry) kept.set(id, entry.profile);
  }
  const missing = testCaseIds.filter((id) => !kept.has(id));
  for (const profile of await getFlakeProfileSummaries(db, missing)) {
    cache.set(String(profile.testCaseId), { projectId, profile });
    kept.set(profile.testCaseId, profile);
  }
  return testCaseIds.flatMap((id) => kept.get(id) ?? []);
}

/** Drop a project's kept profiles, when one of its runs ends. */
export function dropProjectFlakeProfiles(projectId: number): number {
  return cache.deleteWhere((entry) => entry.projectId === projectId);
}
