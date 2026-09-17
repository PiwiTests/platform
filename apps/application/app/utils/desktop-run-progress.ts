/**
 * Aggregate the desktop shell's active local runs into a single progress
 * descriptor for the OS shell — the taskbar/Dock progress bar, the window title
 * and the tray tooltip. A window has one taskbar button, so many concurrent runs
 * collapse to one bar: the summed fraction across runs that have a countable
 * total, or an indeterminate bar while any active run is in a countless phase
 * (install / checkout / bisect, or a test run before Playwright has announced its
 * total). Pure and framework-free so it can be unit-tested; the client plugin
 * (`desktop-run-progress.client.ts`) watches the run store and feeds the result
 * to `desktop_set_run_progress`.
 */
import type { LocalRun } from '~/composables/useDesktopLocalRuns';
import { localRunProgressLabel } from '~/composables/useDesktopLocalRuns';

/** Mirrors the shell's `desktop_set_run_progress` `state` argument. */
export type RunProgressState = 'none' | 'indeterminate' | 'normal' | 'error' | 'paused';

export interface AggregatedRunProgress {
  state: RunProgressState;
  /** 0–1 when determinate; `null` for an indeterminate or cleared bar. */
  fraction: number | null;
  /** Detail line for the window title and tray tooltip; `null` when cleared. */
  label: string | null;
}

/** The cleared state — no active runs, nothing on the shell. */
export const NO_RUN_PROGRESS: AggregatedRunProgress = { state: 'none', fraction: null, label: null };

/**
 * A run with no countable test total yet. Reproduce/bisect runs move through
 * phases (checkout · install · browser · test) whose progress the shell does not
 * total, and a plain test run is countless until Playwright's "Running N tests"
 * line sets `progressTotal`.
 */
function isCountless(run: LocalRun): boolean {
  if (run.kind !== 'tests') return true;
  return !run.progressTotal;
}

/**
 * Fold the runs into one progress descriptor. Only `running` runs count; a call
 * with none active returns the cleared state (the plugin decides whether to flash
 * a finished run's outcome first).
 */
export function aggregateRunProgress(runs: LocalRun[]): AggregatedRunProgress {
  const active = runs.filter((r) => r.status === 'running');
  if (active.length === 0) return NO_RUN_PROGRESS;

  const done = active.reduce((sum, r) => sum + r.progressDone, 0);
  const total = active.reduce((sum, r) => sum + (r.progressTotal ?? 0), 0);
  const countless = active.some(isCountless);
  const fraction = countless || total <= 0 ? null : Math.min(done / total, 1);

  const label =
    active.length === 1
      ? localRunProgressLabel(active[0]!)
      : fraction == null
        ? `Running ${active.length} runs…`
        : `Running ${done}/${total} · ${active.length} runs`;

  return { state: fraction == null ? 'indeterminate' : 'normal', fraction, label };
}
