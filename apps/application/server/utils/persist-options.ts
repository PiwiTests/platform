/**
 * How a batch of executions is persisted when it does not come from a live
 * report. Shared by the server's `persistRunCases` and the demo mirror.
 */
export interface PersistRunCasesOptions {
  /**
   * Date each execution from its attempt's start (`startedAt`), or from this
   * time when it records none, rather than from the moment it is stored.
   */
  datedFrom?: Date;
  /**
   * Leave the tests' stored tags, owner, priority, locks and locator snapshots
   * as they are: the batch comes from a run older than the project's newest.
   */
  keepTestState?: boolean;
}

/** The creation time of an execution persisted with `datedFrom`: its attempt's start, else the given time. */
export function executionCreatedAt(startedAt: number | null | undefined, datedFrom: Date): Date {
  return typeof startedAt === 'number' && Number.isFinite(startedAt) && startedAt > 0 ? new Date(startedAt) : datedFrom;
}
