/**
 * Desktop shell: render live run progress on the OS.
 *
 * While any test run the app knows about is in flight — one reported from CI or
 * a terminal, or one launched from the app — the shell shows its progress on the
 * taskbar/Dock progress bar, the window title and the tray tooltip/icon, so a run
 * can be watched with the window minimised or closed to the tray.
 *
 * Runs are streamed from `/api/desktop/live-runs`: a `snapshot` of the runs
 * already in flight when the shell connects, then live lifecycle + progress
 * deltas. An EventSource is used (not polling) because it keeps delivering while
 * the window is hidden, where background timers are throttled to ~1/min. The
 * active runs are aggregated (`aggregateRunProgress`) and fed to the shell's
 * `desktop_set_run_progress` command; when the last run finishes the outcome
 * flashes (green pass / red fail) briefly before clearing.
 *
 * Activates only inside the shell (the IPC bridge is present); the shared web
 * build has no bridge and this no-ops.
 */
interface LiveRunMessage {
  type:
    | 'snapshot'
    | 'run-progress'
    | 'run-started'
    | 'run-initializing'
    | 'run-finalizing'
    | 'run-finished'
    | 'run-cancelled'
    | 'run-submitted';
  runId?: number;
  status?: string;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  didNotRunTests?: number;
  runs?: Array<{
    id: number;
    status: string;
    totalTests?: number;
    passedTests?: number;
    failedTests?: number;
    skippedTests?: number;
    didNotRunTests?: number;
  }>;
}

type Counts = Pick<LiveRunMessage, 'totalTests' | 'passedTests' | 'failedTests' | 'skippedTests' | 'didNotRunTests'>;

/** Tests finished so far — passed + failed + skipped + did-not-run. */
function doneOf(c: Counts): number {
  return (c.passedTests ?? 0) + (c.failedTests ?? 0) + (c.skippedTests ?? 0) + (c.didNotRunTests ?? 0);
}

export default defineNuxtPlugin(() => {
  const core = tauriCore();
  if (!core) return; // not running inside the desktop shell

  // How long the finished-outcome bar lingers before it clears.
  const PASS_FLASH_MS = 3000;
  const FAIL_FLASH_MS = 5000;

  // runId → its current counts; only in-flight runs are kept.
  const active = new Map<number, RunCounts>();
  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSent = '';
  let lastFinishedStatus: string | null = null;

  function send(state: RunProgressState, fraction: number | null, label: string | null) {
    // Collapse identical updates — progress events are frequent but the shell
    // only needs the changes.
    const key = `${state}|${fraction ?? ''}|${label ?? ''}`;
    if (key === lastSent) return;
    lastSent = key;
    core!.invoke('desktop_set_run_progress', { state, fraction, label }).catch(() => {});
  }

  function pushUpdate() {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    const agg = aggregateRunProgress([...active.values()]);
    if (agg.state !== 'none') {
      lastFinishedStatus = null;
      send(agg.state, agg.fraction, agg.label);
      return;
    }
    // Nothing in flight — flash the last finished run's outcome, then clear.
    if (lastFinishedStatus === 'passed') {
      send('normal', 1, 'Run passed');
      clearTimer = setTimeout(() => send('none', null, null), PASS_FLASH_MS);
    } else if (lastFinishedStatus && lastFinishedStatus !== 'cancelled') {
      send('error', 1, 'Run failed');
      clearTimer = setTimeout(() => send('none', null, null), FAIL_FLASH_MS);
    } else {
      send('none', null, null);
    }
    lastFinishedStatus = null;
  }

  function handle(msg: LiveRunMessage) {
    switch (msg.type) {
      case 'snapshot': {
        active.clear();
        for (const r of msg.runs ?? []) {
          if (ACTIVE_RUN_STATUSES.has(r.status)) {
            active.set(r.id, { status: r.status, done: doneOf(r), total: r.totalTests ?? 0 });
          }
        }
        pushUpdate();
        break;
      }
      case 'run-progress': {
        if (msg.runId == null) break;
        active.set(msg.runId, { status: 'running', done: doneOf(msg), total: msg.totalTests ?? 0 });
        pushUpdate();
        break;
      }
      case 'run-started':
      case 'run-initializing': {
        // Known to be in flight but no counts yet → indeterminate until progress.
        if (msg.runId != null && !active.has(msg.runId)) {
          active.set(msg.runId, { status: 'running', done: 0, total: 0 });
          pushUpdate();
        }
        break;
      }
      case 'run-finished':
      case 'run-cancelled':
      case 'run-submitted': {
        if (msg.runId != null) active.delete(msg.runId);
        lastFinishedStatus = msg.type === 'run-finished' ? (msg.status ?? 'passed') : 'cancelled';
        pushUpdate();
        break;
      }
      // 'run-finalizing' keeps the run active with its current counts — nothing to do.
    }
  }

  function connect() {
    // Server resends a fresh snapshot on (re)connect, so EventSource's automatic
    // reconnection re-seeds `active` without extra work here.
    const source = new EventSource('/api/desktop/live-runs');
    source.onmessage = (event) => {
      try {
        handle(JSON.parse(event.data) as LiveRunMessage);
      } catch {
        // Non-JSON keep-alive comment, or a malformed frame — ignore.
      }
    };
    source.onerror = () => {
      // EventSource reconnects on its own; the next snapshot corrects the state.
    };
  }
  connect();

  // The Windows taskbar thumbnail toolbar's "Stop" button reaches the dashboard
  // as this event. Only local ("Run locally") runs can be stopped from here, so
  // this is best-effort and must never break the progress stream above.
  try {
    const { runs, stopRun } = useDesktopLocalRuns();
    tauriEvent()
      ?.listen('piwi:taskbar-stop', () => {
        for (const run of runs.value) {
          if (run.status === 'running') void stopRun(run);
        }
      })
      .catch(() => {});
  } catch {
    // Local-run store unavailable at init — progress still works.
  }
});
