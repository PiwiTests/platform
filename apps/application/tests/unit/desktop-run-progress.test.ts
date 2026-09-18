import { describe, test, expect } from 'vitest';
import { aggregateRunProgress, NO_RUN_PROGRESS, type RunCounts } from '../../app/utils/desktop-run-progress';

function run(status: string, done: number, total: number): RunCounts {
  return { status, done, total };
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
    expect(result).toEqual({ state: 'indeterminate', fraction: null, label: 'Running 2 runs…' });
  });

  test('retried tests never push the fraction past 100%', () => {
    expect(aggregateRunProgress([run('running', 8, 5)]).fraction).toBe(1);
  });

  test('finished runs are ignored while another is still active', () => {
    const result = aggregateRunProgress([run('passed', 100, 100), run('running', 2, 10)]);
    expect(result.fraction).toBeCloseTo(2 / 10);
    expect(result.label).toBe('Running 2/10…');
  });
});
