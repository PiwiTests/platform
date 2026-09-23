/**
 * A per-project mutex for the feature-graph recompute and rebuild. Both walk a
 * project's whole history and upsert the same graph and gap rows, so two running
 * at once for one project waste work and race each other's writes. This serializes
 * them per project: a second call for a project already running waits for the
 * first, so only one runs per project at a time. Other projects are unaffected.
 *
 * In-memory and best-effort — it guards the common case (a finished run and a
 * manual recompute overlapping) within one server process, not a multi-node
 * deployment, where the upserts are still idempotent.
 */
const inFlight = new Map<number, Promise<unknown>>();

export async function withProjectGraphLock<T>(projectId: number, fn: () => Promise<T>): Promise<T> {
  const prior = inFlight.get(projectId) ?? Promise.resolve();
  // Chain onto any prior work for this project, swallowing its result/error so a
  // failed predecessor never rejects the follower before it even runs.
  const run = prior.then(
    () => fn(),
    () => fn(),
  );
  // Track the tail so the next caller waits on this one; clean up when it is the tail.
  inFlight.set(projectId, run);
  try {
    return await run;
  } finally {
    if (inFlight.get(projectId) === run) inFlight.delete(projectId);
  }
}
