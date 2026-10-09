/**
 * Whether an execution is the latest of its test, for the line under a failing
 * execution's headline that answers "does it still fail?". Pure: the caller
 * loads the newer executions of the same test (`getNewerExecutions`), every
 * Playwright project, every branch, lab runs left out, and this sums them up.
 *
 * Only the same Playwright project counts (`browserName`, null equal to null):
 * a Chromium failure is neither confirmed nor cleared by a Firefox pass. A run
 * stores one row per attempt, so each newer run is read through its final
 * attempt; a later attempt of the execution's own run counts as newer too.
 */
import { isFailedStatus } from '#shared/utils/test-counts';

/** One newer execution of the same test, as `getNewerExecutions` selects it. */
export interface NewerExecutionRow {
  id: number;
  runId: number;
  status: string;
  retries: number | null;
  browserName: string | null;
  failureClusterId: number | null;
  /** The run's start time. */
  startTime: string | number | Date | null;
}

/** The execution the page shows. */
export interface LatestExecutionCurrent {
  runId: number;
  browserName: string | null;
  failureClusterId: number | null;
}

export interface LatestExecution {
  /** No newer execution of the test in the same Playwright project. */
  isLatest: boolean;
  /** The newest execution of the test in the same project: a later run's final attempt, else a later attempt of this run. */
  newest: {
    executionId: number;
    runId: number;
    status: string;
    retries: number;
    /** The run's start time. */
    at: string | number | Date | null;
    /** A later attempt of the execution's own run. */
    sameRun: boolean;
    /** It failed in the execution's own failure cluster. */
    sameCluster: boolean;
  } | null;
  /** The later runs it failed in again, newest first, up to the newest run it did not fail in. */
  failedAgainRunIds: number[];
  failedAgainCount: number;
  /** Another Playwright project ran the test later. */
  laterInOtherProject: boolean;
  /** The Playwright project the line is about, null when the execution names none. */
  projectName: string | null;
}

function startMs(value: NewerExecutionRow['startTime']): number {
  if (value == null) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Sum up the newer executions of the test the current execution belongs to. */
export function summarizeNewerExecutions(
  current: LatestExecutionCurrent,
  rows: ReadonlyArray<NewerExecutionRow>,
): LatestExecution {
  const project = current.browserName ?? null;
  const sameProject = rows.filter((r) => (r.browserName ?? null) === project);
  const laterInOtherProject = rows.some((r) => (r.browserName ?? null) !== project);

  // The final attempt of each run: the row with the highest retry.
  const finalByRun = new Map<number, NewerExecutionRow>();
  for (const r of sameProject) {
    const prev = finalByRun.get(r.runId);
    if (!prev || (r.retries ?? 0) > (prev.retries ?? 0)) finalByRun.set(r.runId, r);
  }
  // Newest first: later runs by start time, then id; the execution's own run is the oldest.
  const finals = [...finalByRun.values()].sort((a, b) => {
    const aOwn = a.runId === current.runId ? 1 : 0;
    const bOwn = b.runId === current.runId ? 1 : 0;
    if (aOwn !== bOwn) return aOwn - bOwn;
    return startMs(b.startTime) - startMs(a.startTime) || b.runId - a.runId;
  });

  const failedAgainRunIds: number[] = [];
  for (const r of finals) {
    if (r.runId === current.runId || !isFailedStatus(r.status)) break;
    failedAgainRunIds.push(r.runId);
  }

  const top = finals[0] ?? null;
  return {
    isLatest: top == null,
    newest: top
      ? {
          executionId: top.id,
          runId: top.runId,
          status: top.status,
          retries: top.retries ?? 0,
          at: top.startTime,
          sameRun: top.runId === current.runId,
          sameCluster: top.failureClusterId != null && top.failureClusterId === current.failureClusterId,
        }
      : null,
    failedAgainRunIds,
    failedAgainCount: failedAgainRunIds.length,
    laterInOtherProject,
    projectName: project || null,
  };
}
