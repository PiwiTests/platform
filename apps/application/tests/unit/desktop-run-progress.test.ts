import { describe, test, expect } from 'vitest';
import { aggregateRunProgress, NO_RUN_PROGRESS } from '../../app/utils/desktop-run-progress';
import { DEFAULT_LOCAL_RUN_OPTIONS, type LocalRun } from '../../app/composables/useDesktopLocalRuns';

/** A `LocalRun` with sane defaults; override only what a case cares about. */
function run(overrides: Partial<LocalRun>): LocalRun {
  return {
    key: 1,
    kind: 'tests',
    projectId: 'p1',
    projectLabel: null,
    cases: [],
    options: DEFAULT_LOCAL_RUN_OPTIONS,
    steps: [],
    stepIndex: 0,
    phase: null,
    browserName: null,
    commit: null,
    good: null,
    bad: null,
    bisect: null,
    bisectTarget: null,
    status: 'running',
    lines: [],
    exitCode: null,
    startedAt: 0,
    finishedAt: null,
    shellId: null,
    stopRequested: false,
    progressTotal: null,
    progressDone: 0,
    piwiRunId: null,
    piwiRunBaseline: null,
    ...overrides,
  };
}

describe('aggregateRunProgress', () => {
  test('no runs, or only finished runs, clears the bar', () => {
    expect(aggregateRunProgress([])).toEqual(NO_RUN_PROGRESS);
    expect(aggregateRunProgress([run({ status: 'passed' }), run({ status: 'failed' })])).toEqual(NO_RUN_PROGRESS);
  });

  test('a single counted test run is a determinate fraction with a count label', () => {
    const result = aggregateRunProgress([run({ progressTotal: 12, progressDone: 3 })]);
    expect(result.state).toBe('normal');
    expect(result.fraction).toBeCloseTo(3 / 12);
    expect(result.label).toBe('Running 3/12…');
  });

  test('a test run before its total is announced is indeterminate', () => {
    const result = aggregateRunProgress([run({ progressTotal: null, progressDone: 0 })]);
    expect(result).toEqual({ state: 'indeterminate', fraction: null, label: 'Running…' });
  });

  test('a reproduce run is always indeterminate and labelled by its phase', () => {
    const result = aggregateRunProgress([run({ kind: 'reproduce', phase: 'install' })]);
    expect(result.state).toBe('indeterminate');
    expect(result.fraction).toBeNull();
    expect(result.label).toBe('Installing…');
  });

  test('concurrent counted runs sum into one fraction', () => {
    const result = aggregateRunProgress([
      run({ progressTotal: 10, progressDone: 4 }),
      run({ key: 2, progressTotal: 20, progressDone: 6 }),
    ]);
    expect(result.state).toBe('normal');
    expect(result.fraction).toBeCloseTo(10 / 30);
    expect(result.label).toBe('Running 10/30 · 2 runs');
  });

  test('one countless run among several makes the whole bar indeterminate', () => {
    const result = aggregateRunProgress([run({ progressTotal: 10, progressDone: 4 }), run({ key: 2, kind: 'bisect' })]);
    expect(result).toEqual({ state: 'indeterminate', fraction: null, label: 'Running 2 runs…' });
  });

  test('retried tests never push the fraction past 100%', () => {
    const result = aggregateRunProgress([run({ progressTotal: 5, progressDone: 8 })]);
    expect(result.fraction).toBe(1);
  });

  test('finished runs are ignored while another is still active', () => {
    const result = aggregateRunProgress([
      run({ status: 'passed', progressTotal: 100, progressDone: 100 }),
      run({ key: 2, progressTotal: 10, progressDone: 2 }),
    ]);
    expect(result.fraction).toBeCloseTo(2 / 10);
    expect(result.label).toBe('Running 2/10…');
  });
});
