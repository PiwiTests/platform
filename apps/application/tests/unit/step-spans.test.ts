import { describe, test, expect } from 'vitest';
import { buildStepSpans } from '../../app/utils/step-spans';
import type { PerformanceStep } from '../../types/api';

function step(partial: Partial<PerformanceStep> & { title: string }): PerformanceStep {
  return { duration: 0, category: 'other', ...partial } as PerformanceStep;
}

describe('buildStepSpans', () => {
  test('returns an empty result for no steps', () => {
    expect(buildStepSpans([], 1000)).toEqual({ spans: [], maxDepth: 0, estimated: false });
    expect(buildStepSpans(null, 1000).spans).toHaveLength(0);
  });

  test('nests children under a containing parent by time', () => {
    // A "Sign in" test.step [0..100] wrapping a fill [10..40] and a click [50..90].
    const { spans, maxDepth, estimated } = buildStepSpans(
      [
        step({ title: 'Sign in', category: 'test.step', startTime: 1000, duration: 100 }),
        step({ title: 'Fill email', category: 'input', startTime: 1010, duration: 30 }),
        step({ title: 'Click submit', category: 'action', startTime: 1050, duration: 40 }),
      ],
      1000,
    );
    expect(estimated).toBe(false);
    expect(maxDepth).toBe(2);
    expect(spans.find((s) => s.title === 'Sign in')!.depth).toBe(1);
    expect(spans.find((s) => s.title === 'Fill email')!.depth).toBe(2);
    expect(spans.find((s) => s.title === 'Click submit')!.depth).toBe(2);
  });

  test('keeps sequential (non-overlapping) steps at the same depth', () => {
    const { spans, maxDepth } = buildStepSpans(
      [
        step({ title: 'a', startTime: 1000, duration: 100 }),
        step({ title: 'b', startTime: 1100, duration: 100 }),
        step({ title: 'c', startTime: 1200, duration: 100 }),
      ],
      1000,
    );
    expect(maxDepth).toBe(1);
    expect(spans.every((s) => s.depth === 1)).toBe(true);
  });

  test('handles three levels of nesting', () => {
    const { maxDepth, spans } = buildStepSpans(
      [
        step({ title: 'outer', startTime: 0, duration: 100 }),
        step({ title: 'middle', startTime: 10, duration: 50 }),
        step({ title: 'inner', startTime: 20, duration: 10 }),
      ],
      0,
    );
    expect(maxDepth).toBe(3);
    expect(spans.find((s) => s.title === 'inner')!.depth).toBe(3);
  });

  test('preserves input order in the returned spans', () => {
    const { spans } = buildStepSpans(
      [step({ title: 'parent', startTime: 0, duration: 100 }), step({ title: 'child', startTime: 10, duration: 10 })],
      0,
    );
    expect(spans.map((s) => s.title)).toEqual(['parent', 'child']);
  });

  test('lays steps end-to-end and flags estimated when start times are missing', () => {
    const { spans, estimated, maxDepth } = buildStepSpans(
      [step({ title: 'a', duration: 100 }), step({ title: 'b', duration: 200 })],
      5000,
    );
    expect(estimated).toBe(true);
    expect(maxDepth).toBe(1);
    expect(spans[0]).toMatchObject({ startTime: 5000, duration: 100, depth: 1 });
    expect(spans[1]).toMatchObject({ startTime: 5100, duration: 200, depth: 1 });
  });

  test('marks a failed step and carries its error and params', () => {
    const { spans } = buildStepSpans(
      [
        step({
          title: 'Click',
          category: 'action',
          startTime: 0,
          duration: 10,
          error: { message: 'boom' },
          params: { locator: "getByRole('button')" },
        }),
      ],
      0,
    );
    expect(spans[0]!.failed).toBe(true);
    expect(spans[0]!.status).toBe('failed');
    expect(spans[0]!.error).toBe('boom');
    expect(spans[0]!.params).toEqual({ locator: "getByRole('button')" });
  });
});
