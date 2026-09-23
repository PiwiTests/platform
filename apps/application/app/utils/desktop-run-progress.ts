/**
 * Aggregate the in-flight test runs into a single progress descriptor for the
 * OS shell — the taskbar/Dock progress bar, the window title and the tray
 * tooltip/icon. A window has one taskbar button, so many concurrent runs
 * collapse to one bar: the summed fraction across runs whose total is known, or
 * an indeterminate bar while any active run has no total yet.
 *
 * Runs here are the app's *live* runs — every run reported into the app (from
 * CI, a terminal, or the desktop's own "Run locally"), not just ones launched
 * from the app. The desktop plugin (`desktop-run-progress.client.ts`) streams
 * them from `/api/desktop/live-runs` and feeds the result to the shell's
 * `desktop_set_run_progress` command. Pure and framework-free so it is unit-tested.
 */

/** Mirrors the shell's `desktop_set_run_progress` `state` argument. */
export type RunProgressState = 'none' | 'indeterminate' | 'normal' | 'error' | 'paused';

export interface AggregatedRunProgress {
  state: RunProgressState;
  /** 0–1 when determinate; `null` for an indeterminate or cleared bar. */
  fraction: number | null;
  /** Detail line for the window title and tray tooltip; `null` when cleared. */
  label: string | null;
}

/** The completion tally + planned total of one run, as the counts aggregate needs them. */
export interface RunCounts {
  status: string;
  /** Tests finished so far (passed + failed + skipped + did-not-run). */
  done: number;
  /** Planned suite size; `0`/unknown makes the run (and the bar) indeterminate. */
  total: number;
}

/** An in-flight run as the desktop plugin tracks it: its counts and its project. */
export interface LiveRun extends RunCounts {
  projectId: number | null;
}

/** The cleared state — no active runs, nothing on the shell. */
export const NO_RUN_PROGRESS: AggregatedRunProgress = { state: 'none', fraction: null, label: null };

/** Run statuses that count as in-flight (mirrors the server's ACTIVE_STATUSES). */
export const ACTIVE_RUN_STATUSES: ReadonlySet<string> = new Set(['running', 'initializing', 'finalizing']);

/**
 * Fold the in-flight runs into one progress descriptor. Only active runs count;
 * with none active it returns the cleared state (the plugin decides whether to
 * flash a finished run's outcome first).
 */
export function aggregateRunProgress(runs: readonly RunCounts[]): AggregatedRunProgress {
  const active = runs.filter((r) => ACTIVE_RUN_STATUSES.has(r.status));
  if (active.length === 0) return NO_RUN_PROGRESS;

  const done = active.reduce((sum, r) => sum + Math.max(0, r.done), 0);
  const total = active.reduce((sum, r) => sum + Math.max(0, r.total), 0);
  // Indeterminate while any active run hasn't reported a total yet — a partial
  // sum would make the bar jump backwards when that run's total lands.
  const countless = active.some((r) => r.total <= 0);
  const fraction = countless || total <= 0 ? null : Math.min(done / total, 1);

  const label =
    active.length === 1
      ? fraction == null
        ? 'Running…'
        : `Running ${done}/${total}…`
      : fraction == null
        ? `Running ${active.length} runs…`
        : `Running ${done}/${total} · ${active.length} runs`;

  return { state: fraction == null ? 'indeterminate' : 'normal', fraction, label };
}

/** How long a finished run's outcome stays on the shell before the bar clears. */
export const PASS_FLASH_MS = 3000;
export const FAIL_FLASH_MS = 5000;

export interface FinishedRunFlash {
  progress: AggregatedRunProgress;
  durationMs: number;
}

/**
 * What the shell shows once the last active run ends with `status`, and for how
 * long, or `null` to clear the bar at once. A pass flashes green, an
 * interrupted run (stopped, or its reporter lost) amber, any other failure red;
 * a cancelled run clears without a flash.
 */
export function finishedRunFlash(status: string): FinishedRunFlash | null {
  switch (status) {
    case 'passed':
      return { progress: { state: 'normal', fraction: 1, label: 'Run passed' }, durationMs: PASS_FLASH_MS };
    case 'interrupted':
      return { progress: { state: 'paused', fraction: 1, label: 'Run interrupted' }, durationMs: FAIL_FLASH_MS };
    case 'cancelled':
      return null;
    default:
      return { progress: { state: 'error', fraction: 1, label: 'Run failed' }, durationMs: FAIL_FLASH_MS };
  }
}

/**
 * The tracked runs a stopped local process produced: the runs of its project
 * numbered above `baseline`, the project's newest run id when the process was
 * spawned. The shell kills the process, so its reporter never reports the end.
 */
export function runsOfStoppedLocalRun(
  active: ReadonlyMap<number, LiveRun>,
  projectId: string,
  baseline: number,
): number[] {
  const ids: number[] = [];
  for (const [id, run] of active) {
    if (id > baseline && run.projectId != null && String(run.projectId) === projectId) ids.push(id);
  }
  return ids;
}
