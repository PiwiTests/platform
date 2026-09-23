import { describe, test, expect } from 'vitest';
import {
  aggregateRunProgress,
  finishedRunFlash,
  runsOfStoppedLocalRun,
  FAIL_FLASH_MS,
  NO_RUN_PROGRESS,
  PASS_FLASH_MS,
  type LiveRun,
  type RunCounts,
} from '../../app/utils/desktop-run-progress';

function run(status: string, done: number, total: number, failed = 0): RunCounts {
  return { status, done, total, failed };
}

describe('aggregateRunProgress', () => {
  test('no runs, or only finished runs, clears the bar', () => {
    expect(aggregateRunProgress([])).toEqual(NO_RUN_PROGRESS);
    expect(aggregateRunProgress([run('passed', 12, 12), run('failed', 3, 10)])).toEqual(NO_RUN_PROGRESS);
  });

  test('a single counted run is a determinate fraction with a count label', () => {
    const result = aggregateRunProgress([run('running', 3, 12)]);
    expect(result.state).toBe('normal');
    expect(result.fraction).toBeCloseTo(3 / 12);
    expect(result.label).toBe('Running 3/12…');
  });

  test('a run with no total yet is indeterminate', () => {
    expect(aggregateRunProgress([run('initializing', 0, 0)])).toEqual({
      state: 'indeterminate',
      fraction: null,
      label: 'Running…',
      failing: false,
    });
  });

  test('initializing and finalizing runs count as in-flight', () => {
    expect(aggregateRunProgress([run('finalizing', 8, 8)]).state).toBe('normal');
    expect(aggregateRunProgress([run('initializing', 2, 10)]).fraction).toBeCloseTo(2 / 10);
  });

  test('concurrent counted runs sum into one fraction', () => {
    const result = aggregateRunProgress([run('running', 4, 10), run('running', 6, 20)]);
    expect(result.state).toBe('normal');
    expect(result.fraction).toBeCloseTo(10 / 30);
    expect(result.label).toBe('Running 10/30 · 2 runs');
  });

  test('one run with no total makes the whole bar indeterminate', () => {
    const result = aggregateRunProgress([run('running', 4, 10), run('running', 0, 0)]);
    expect(result).toEqual({ state: 'indeterminate', fraction: null, label: 'Running 2 runs…', failing: false });
  });

  test('retried tests never push the fraction past 100%', () => {
    expect(aggregateRunProgress([run('running', 8, 5)]).fraction).toBe(1);
  });

  test('finished runs are ignored while another is still active', () => {
    const result = aggregateRunProgress([run('passed', 100, 100), run('running', 2, 10)]);
    expect(result.fraction).toBeCloseTo(2 / 10);
    expect(result.label).toBe('Running 2/10…');
  });

  test('a run with a failed test is failing, with a red bar and the count in the label', () => {
    const result = aggregateRunProgress([run('running', 5, 12, 2)]);
    expect(result).toMatchObject({ state: 'error', failing: true, label: 'Running 5/12 · 2 failed' });
    expect(result.fraction).toBeCloseTo(5 / 12);
    expect(aggregateRunProgress([run('running', 5, 12)]).failing).toBe(false);
  });

  test('failures sum across concurrent runs', () => {
    const result = aggregateRunProgress([run('running', 4, 10, 1), run('running', 6, 20, 2)]);
    expect(result).toMatchObject({ state: 'error', failing: true, label: 'Running 10/30 · 2 runs · 3 failed' });
  });

  test('an indeterminate bar stays indeterminate when failing — only the dot shows it', () => {
    expect(aggregateRunProgress([run('running', 4, 10, 1), run('running', 0, 0)])).toEqual({
      state: 'indeterminate',
      fraction: null,
      label: 'Running 2 runs · 1 failed',
      failing: true,
    });
  });

  test('a finished run with failures does not make the active ones failing', () => {
    expect(aggregateRunProgress([run('failed', 10, 10, 4), run('running', 2, 10)]).failing).toBe(false);
  });
});

describe('finishedRunFlash', () => {
  test('a pass flashes green and a failure red', () => {
    expect(finishedRunFlash('passed')).toEqual({
      progress: { state: 'normal', fraction: 1, label: 'Run passed', failing: false },
      durationMs: PASS_FLASH_MS,
    });
    for (const status of ['failed', 'timedout']) {
      expect(finishedRunFlash(status)).toEqual({
        progress: { state: 'error', fraction: 1, label: 'Run failed', failing: false },
        durationMs: FAIL_FLASH_MS,
      });
    }
  });

  test('an interrupted run flashes amber, not as a failure', () => {
    expect(finishedRunFlash('interrupted')?.progress).toEqual({
      state: 'paused',
      fraction: 1,
      label: 'Run interrupted',
      failing: false,
    });
  });

  test('a cancelled run clears without a flash', () => {
    expect(finishedRunFlash('cancelled')).toBeNull();
  });
});

describe('runsOfStoppedLocalRun', () => {
  const live = (projectId: number | null): LiveRun => ({ status: 'running', done: 1, total: 10, failed: 0, projectId });

  test('picks the runs of the project numbered above the baseline', () => {
    const active = new Map<number, LiveRun>([
      [4, live(1)], // before the local process was spawned
      [7, live(1)],
      [8, live(2)], // another project
      [9, live(1)],
      [10, live(null)],
    ]);
    expect(runsOfStoppedLocalRun(active, '1', 4)).toEqual([7, 9]);
  });

  test('picks nothing when no run is newer than the baseline', () => {
    expect(runsOfStoppedLocalRun(new Map([[3, live(1)]]), '1', 3)).toEqual([]);
  });
});
