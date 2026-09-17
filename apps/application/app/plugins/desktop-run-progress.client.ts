/**
 * Desktop shell: render local-run progress on the OS.
 *
 * While a local `playwright test` run (or a reproduce/bisect) is in flight, the
 * shell shows its progress on the taskbar/Dock progress bar, the window title
 * and the tray tooltip — so a run can be watched with the window minimised or
 * closed to the tray, without the dashboard open. This plugin watches the run
 * store, aggregates the active runs (`aggregateRunProgress`) and feeds the
 * result to the shell's `desktop_set_run_progress` command. When the last run
 * finishes it briefly flashes the outcome (a full green bar on pass, a red bar
 * on fail) before clearing.
 *
 * Progress shows whenever a run is active, regardless of window focus — matching
 * OS conventions for background work (downloads, installers). Activates only
 * inside the shell (the IPC bridge is present); the shared web build has no
 * bridge and this no-ops.
 */
export default defineNuxtPlugin(() => {
  const core = tauriCore();
  if (!core) return; // not running inside the desktop shell

  const { runs, stopRun } = useDesktopLocalRuns();

  // The Windows taskbar thumbnail toolbar's "Stop" button (see the shell's
  // taskbar_win module) reaches the dashboard as this event — the shell doesn't
  // own which run is current, so stopping the active runs happens here.
  const events = tauriEvent();
  if (events) {
    events
      .listen('piwi:taskbar-stop', () => {
        for (const run of runs.value) {
          if (run.status === 'running') void stopRun(run);
        }
      })
      .catch(() => {});
  }

  // How long the finished-outcome bar lingers before it clears.
  const PASS_FLASH_MS = 3000;
  const FAIL_FLASH_MS = 5000;

  let clearTimer: ReturnType<typeof setTimeout> | null = null;
  let lastSent = '';

  function send(state: RunProgressState, fraction: number | null, label: string | null) {
    // Collapse identical updates — the aggregate recomputes to a fresh object on
    // every store mutation, but the shell only needs the changes.
    const key = `${state}|${fraction ?? ''}|${label ?? ''}`;
    if (key === lastSent) return;
    lastSent = key;
    core!.invoke('desktop_set_run_progress', { state, fraction, label }).catch(() => {});
  }

  const progress = computed(() => aggregateRunProgress(runs.value));

  watch(progress, (now) => {
    if (clearTimer) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }

    if (now.state !== 'none') {
      send(now.state, now.fraction, now.label);
      return;
    }

    // No run is active. Flash the newest finished run's outcome, then clear.
    // `runs` is newest-first, so the first non-running entry is what just ended.
    const finished = runs.value.find((r) => r.status !== 'running');
    if (finished?.status === 'passed') {
      send('normal', 1, 'Run passed');
      clearTimer = setTimeout(() => send('none', null, null), PASS_FLASH_MS);
    } else if (finished?.status === 'failed' || finished?.status === 'error') {
      send('error', 1, 'Run failed');
      clearTimer = setTimeout(() => send('none', null, null), FAIL_FLASH_MS);
    } else {
      // Stopped, or nothing to report — clear immediately.
      send('none', null, null);
    }
  });
});
