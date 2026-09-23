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
 * flashes (green pass / amber interrupted / red fail) briefly before clearing.
 * A local run stopped from the app leaves the bar at once.
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
  projectId?: number;
  status?: string;
  totalTests?: number;
  passedTests?: number;
  failedTests?: number;
  skippedTests?: number;
  didNotRunTests?: number;
  runs?: Array<{
    id: number;
    projectId?: number;
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

  // runId → its current counts; only in-flight runs are kept.
  const active = new Map<number, LiveRun>();
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
    const flash = lastFinishedStatus ? finishedRunFlash(lastFinishedStatus) : null;
    if (flash) {
      send(flash.progress.state, flash.progress.fraction, flash.progress.label);
      clearTimer = setTimeout(() => send('none', null, null), flash.durationMs);
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
            active.set(r.id, {
              status: r.status,
              done: doneOf(r),
              total: r.totalTests ?? 0,
              projectId: r.projectId ?? null,
            });
          }
        }
        pushUpdate();
        break;
      }
      case 'run-progress': {
        if (msg.runId == null) break;
        active.set(msg.runId, {
          status: 'running',
          done: doneOf(msg),
          total: msg.totalTests ?? 0,
          projectId: msg.projectId ?? null,
        });
        pushUpdate();
        break;
      }
      case 'run-started':
      case 'run-initializing': {
        // Known to be in flight but no counts yet → indeterminate until progress.
        if (msg.runId != null && !active.has(msg.runId)) {
          active.set(msg.runId, { status: 'running', done: 0, total: 0, projectId: msg.projectId ?? null });
          pushUpdate();
        }
        break;
      }
      case 'run-finished':
      case 'run-cancelled':
      case 'run-submitted': {
        // Only a run still on the bar has an outcome to show — one already
        // dropped (a stopped local run the server reaps later) changes nothing.
        if (msg.runId == null || !active.delete(msg.runId)) break;
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

  // Local ("Run locally") runs are driven from the app, so they are the only
  // ones it can stop — best-effort, and never allowed to break the progress
  // stream above.
  try {
    const { runs, stopRun } = useDesktopLocalRuns();

    // The Windows taskbar thumbnail toolbar's "Stop" button reaches the
    // dashboard as this event.
    tauriEvent()
      ?.listen('piwi:taskbar-stop', () => {
        for (const run of runs.value) {
          if (run.status === 'running') void stopRun(run);
        }
      })
      .catch(() => {});

    // A stopped local process never reports its end, and the server marks its
    // runs interrupted only after the stale timeout, so drop them from the bar
    // as soon as the stop lands.
    const dropped = new Set<number>();
    watch(
      () => runs.value.map((run) => run.status),
      () => {
        let changed = false;
        for (const run of runs.value) {
          if (run.status !== 'stopped' || run.piwiRunBaseline == null || dropped.has(run.key)) continue;
          dropped.add(run.key);
          for (const id of runsOfStoppedLocalRun(active, run.projectId, run.piwiRunBaseline)) {
            active.delete(id);
            changed = true;
          }
        }
        if (changed) pushUpdate();
      },
    );
  } catch {
    // Local-run store unavailable at init — progress still works.
  }
});
