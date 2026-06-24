import { describe, it, expect } from 'vitest';
import {
  categorizeStep,
  flattenSteps,
  collectStepMetrics,
  percentile,
  computePerformanceSummary,
  extractTestStepEvents,
  extractWaitEvents,
} from '../src/step-analyzer.js';

describe('categorizeStep', () => {
  it('returns "other" for empty title', () => {
    expect(categorizeStep('')).toBe('other');
  });

  it('passes through hook/fixture pwCategory verbatim', () => {
    expect(categorizeStep('Before Hooks', 'hook')).toBe('hook');
    expect(categorizeStep('fixture: browser', 'fixture')).toBe('fixture');
  });

  it('classifies navigation steps', () => {
    expect(categorizeStep('page.goto')).toBe('navigation');
    expect(categorizeStep('Page.goto')).toBe('navigation');
    expect(categorizeStep('page.reload')).toBe('navigation');
    expect(categorizeStep('page.goBack')).toBe('navigation');
    expect(categorizeStep('page.goForward')).toBe('navigation');
  });

  it('classifies action steps', () => {
    expect(categorizeStep('locator.click')).toBe('action');
    expect(categorizeStep('locator.dblclick')).toBe('action');
    expect(categorizeStep('locator.check')).toBe('action');
    expect(categorizeStep('locator.uncheck')).toBe('action');
    expect(categorizeStep('locator.selectOption')).toBe('action');
    expect(categorizeStep('locator.tap')).toBe('action');
  });

  it('classifies input steps', () => {
    expect(categorizeStep('locator.fill')).toBe('input');
    expect(categorizeStep('locator.type')).toBe('input');
    expect(categorizeStep('locator.press')).toBe('input');
    expect(categorizeStep('locator.clear')).toBe('input');
    expect(categorizeStep('locator.setInputFiles')).toBe('input');
  });

  it('classifies assertions', () => {
    expect(categorizeStep('expect.toBeVisible')).toBe('assertion');
    expect(categorizeStep('locator.expect.toBeVisible')).toBe('assertion');
    expect(categorizeStep('page.expect')).toBe('assertion');
  });

  it('classifies wait steps (legacy api-path titles)', () => {
    expect(categorizeStep('locator.waitFor')).toBe('wait');
    expect(categorizeStep('page.waitFor')).toBe('wait');
    expect(categorizeStep('page.waitForLoadState')).toBe('wait');
    expect(categorizeStep('page.waitForURL')).toBe('wait');
    expect(categorizeStep('page.waitForTimeout')).toBe('wait');
    expect(categorizeStep('page.waitForRequest')).toBe('wait');
    expect(categorizeStep('page.waitForResponse')).toBe('wait');
    expect(categorizeStep('page.waitForEvent')).toBe('wait');
    expect(categorizeStep('frame.waitFor')).toBe('wait');
    expect(categorizeStep('frame.waitForTimeout')).toBe('wait');
  });

  it('classifies wait steps (modern human-readable titles)', () => {
    // Playwright >=1.5x emits human-readable step titles instead of api paths.
    expect(categorizeStep('Wait for timeout', 'pw:api')).toBe('wait');
    expect(categorizeStep('Wait for load state', 'pw:api')).toBe('wait');
    expect(categorizeStep('Wait for navigation', 'pw:api')).toBe('wait');
    expect(categorizeStep('Wait for selector', 'pw:api')).toBe('wait');
    expect(categorizeStep('Wait for function', 'pw:api')).toBe('wait');
    expect(categorizeStep('Wait for event', 'pw:api')).toBe('wait');
    expect(categorizeStep('Wait for URL', 'pw:api')).toBe('wait');
  });

  it('classifies modern human-readable navigation/action/input/expect titles', () => {
    expect(categorizeStep('Navigate to "https://example.com"', 'pw:api')).toBe('navigation');
    expect(categorizeStep('Go back', 'pw:api')).toBe('navigation');
    expect(categorizeStep('Reload', 'pw:api')).toBe('navigation');
    expect(categorizeStep('Click', 'pw:api')).toBe('action');
    expect(categorizeStep('Double click', 'pw:api')).toBe('action');
    expect(categorizeStep('Check', 'pw:api')).toBe('action');
    expect(categorizeStep('Fill "value"', 'pw:api')).toBe('input');
    expect(categorizeStep('Press "Enter"', 'pw:api')).toBe('input');
    expect(categorizeStep('Set input files', 'pw:api')).toBe('input');
    // expect steps carry pwCategory 'expect'
    expect(categorizeStep('Expect "toBeVisible"', 'expect')).toBe('assertion');
  });

  it('classifies api steps', () => {
    expect(categorizeStep('apiRequestContext.get')).toBe('api');
    expect(categorizeStep('apiResponse')).toBe('api');
  });

  it('classifies hook phrases', () => {
    expect(categorizeStep('Before Hooks')).toBe('hook');
    expect(categorizeStep('After Hooks')).toBe('hook');
    expect(categorizeStep('fixture: browser')).toBe('hook');
  });

  it('returns "other" for unknown titles', () => {
    expect(categorizeStep('someCustomStep')).toBe('other');
  });
});

describe('flattenSteps', () => {
  it('flattens nested step trees depth-first', () => {
    const steps = [
      { title: 'page.goto', duration: 10, category: 'navigation', steps: [
        { title: 'locator.click', duration: 5, steps: [] },
        { title: 'expect.toBe', duration: 2, steps: [
          { title: 'inner', duration: 1, steps: [] },
        ] },
      ] },
      { title: 'outer', duration: 3, steps: [] },
    ];
    const flat = flattenSteps(steps as any);
    expect(flat.length).toBe(5);
    expect(
      flat.map((s) => s.title),
    ).toEqual(['page.goto', 'locator.click', 'expect.toBe', 'inner', 'outer']);
    expect(flat[0].category).toBe('navigation');
    expect(flat[1].category).toBe('action');
    expect(flat[2].category).toBe('assertion');
    expect(flat[3].category).toBe('other');
  });

  it('handles empty input', () => {
    expect(flattenSteps([])).toEqual([]);
  });

  it('preserves durations', () => {
    const flat = flattenSteps([{ title: 'x', duration: 42, steps: [] }] as any);
    expect(flat[0].duration).toBe(42);
  });
});

describe('collectStepMetrics', () => {
  it('aggregates flat steps, slowest step, and navigation stats', () => {
    const steps = [
      { title: 'page.goto', duration: 100, steps: [] },
      { title: 'locator.click', duration: 50, steps: [] },
      { title: 'page.reload', duration: 80, steps: [] },
    ];
    const m = collectStepMetrics(steps as any);
    expect(m.steps.length).toBe(3);
    expect(m.totalStepDuration).toBe(230);
    expect(m.slowestStep).toEqual({ title: 'page.goto', duration: 100 });
    expect(m.navigationCount).toBe(2);
    expect(m.navigationTotalDuration).toBe(180);
  });

  it('returns null slowestStep when there are no flat steps', () => {
    const m = collectStepMetrics([] as any);
    expect(m.slowestStep).toBe(null);
    expect(m.totalStepDuration).toBe(0);
    expect(m.navigationCount).toBe(0);
    expect(m.waitCount).toBe(0);
    expect(m.waitTotalDuration).toBe(0);
  });

  it('aggregates wait metrics', () => {
    const steps = [
      { title: 'page.waitForTimeout', duration: 5000, steps: [] },
      { title: 'locator.click', duration: 100, steps: [] },
      { title: 'page.waitForLoadState', duration: 3000, steps: [] },
    ];
    const m = collectStepMetrics(steps as any);
    expect(m.waitCount).toBe(2);
    expect(m.waitTotalDuration).toBe(8000);
  });

  it('totalStepDuration sums top-level only (nested not double-counted)', () => {
    const steps = [
      { title: 'outer', duration: 100, steps: [{ title: 'inner', duration: 50, steps: [] }] },
    ];
    const m = collectStepMetrics(steps as any);
    expect(m.totalStepDuration).toBe(100); // reduce over top-level only
  });
});

describe('percentile', () => {
  it('returns 0 for empty array', () => {
    expect(percentile([], 50)).toBe(0);
  });

  it('computes p50, p90, p95 on a sorted array', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // index = ceil(p/100 * n) - 1
    // p50: ceil(5) - 1 = 4 -> 5
    // p90: ceil(9) - 1 = 8 -> 9
    // p95: ceil(9.5) - 1 = 9 -> 10
    expect(percentile(sorted, 50)).toBe(5);
    expect(percentile(sorted, 90)).toBe(9);
    expect(percentile(sorted, 95)).toBe(10);
  });

  it('clamps index to 0 for low percentiles', () => {
    expect(percentile([42], 10)).toBe(42);
    expect(percentile([42], 1)).toBe(42);
  });
});

describe('computePerformanceSummary', () => {
  it('returns empty object when no test cases have durations', () => {
    expect(computePerformanceSummary([])).toEqual({});
    expect(computePerformanceSummary([{ duration: null }])).toEqual({});
  });

  it('computes averages, percentiles, and slowest tests', () => {
    const cases = [
      { title: 'a', duration: 100 },
      { title: 'b', duration: 200 },
      { title: 'c', duration: 300 },
    ];
    const s = computePerformanceSummary(cases as any);
    expect(s.avgTestDuration).toBe(200);
    expect(s.p50TestDuration).toBe(200);
    expect(s.p90TestDuration).toBe(300);
    expect(s.p95TestDuration).toBe(300);
    expect(s.slowestTests).toEqual([
      { title: 'c', duration: 300 },
      { title: 'b', duration: 200 },
      { title: 'a', duration: 100 },
    ]);
  });

  it('caps slowest tests at 5', () => {
    const cases = Array.from({ length: 10 }, (_, i) => ({ title: `t${i}`, duration: i * 10 }));
    const s = computePerformanceSummary(cases as any);
    expect(s.slowestTests?.length).toBe(5);
    expect(s.slowestTests?.[0].title).toBe('t9');
  });

  it('aggregates navigation stats from performanceMetrics', () => {
    const cases = [
      { title: 'a', duration: 100, performanceMetrics: { navigationTotalDuration: 50, navigationCount: 2 } },
      { title: 'b', duration: 200, performanceMetrics: { navigationTotalDuration: 30, navigationCount: 3 } },
    ];
    const s = computePerformanceSummary(cases as any);
    expect(s.totalNavigationDuration).toBe(80);
    expect(s.avgNavigationDuration).toBe(Math.round(80 / 5));
  });

  it('avgNavigationDuration is 0 when no navigation steps', () => {
    const s = computePerformanceSummary([{ title: 'a', duration: 100 }] as any);
    expect(s.avgNavigationDuration).toBe(0);
    expect(s.totalNavigationDuration).toBe(0);
  });

  it('computes totalWastedTimeMs from performanceMetrics', () => {
    const cases = [
      { title: 'a', duration: 100, performanceMetrics: { waitTotalDuration: 5000, waitCount: 1 } },
      { title: 'b', duration: 200, performanceMetrics: { waitTotalDuration: 3000, waitCount: 2 } },
    ];
    const s = computePerformanceSummary(cases as any);
    expect(s.totalWastedTimeMs).toBe(8000);
  });

  it('totalWastedTimeMs is 0 when no wait durations', () => {
    const s = computePerformanceSummary([{ title: 'a', duration: 100 }] as any);
    expect(s.totalWastedTimeMs).toBe(0);
  });
});

describe('extractTestStepEvents', () => {
  it('extracts only hook/fixture top-level steps with absolute timings', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const steps = [
      { title: 'Before Hooks', category: 'hook', startTime: start, duration: 10, location: { file: 'a.ts', line: 1, column: 2 } },
      { title: 'locator.click', category: 'action', startTime: start, duration: 5 },
      { title: 'fixture: browser', category: 'fixture', startTime: start, duration: 3, error: new Error('x') },
    ];
    const events = extractTestStepEvents(steps as any, start);
    expect(events.length).toBe(2);
    expect(events[0].title).toBe('Before Hooks');
    expect(events[0].category).toBe('hook');
    expect(events[0].startedAt).toBe(start.getTime());
    expect(events[0].status).toBe('passed');
    expect(events[0].location).toBe('a.ts:1:2');
    expect(events[1].status).toBe('failed'); // error present
  });

  it('skips steps without startTime', () => {
    const events = extractTestStepEvents([{ title: 'Before Hooks', category: 'hook', duration: 1 }] as any, new Date());
    expect(events.length).toBe(0);
  });

  it('accepts numeric startTime (passes through)', () => {
    const events = extractTestStepEvents(
      [{ title: 'Before Hooks', category: 'hook', startTime: 12345, duration: 1 }] as any,
      new Date(),
    );
    expect(events[0].startedAt).toBe(12345);
  });
});

describe('extractWaitEvents', () => {
  it('extracts wait-category steps with absolute timings', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const steps = [
      { title: 'page.waitForTimeout', category: undefined, startTime: start, duration: 5000, location: { file: 'test.spec.ts', line: 10, column: 5 } },
      { title: 'locator.click', category: 'action', startTime: start, duration: 100 },
    ];
    const events = extractWaitEvents(steps as any);
    expect(events.length).toBe(1);
    expect(events[0].title).toBe('page.waitForTimeout');
    expect(events[0].category).toBe('wait');
    expect(events[0].startedAt).toBe(start.getTime());
    expect(events[0].duration).toBe(5000);
    expect(events[0].status).toBe('wasted');
    expect(events[0].location).toBe('test.spec.ts:10:5');
  });

  it('skips steps without startTime', () => {
    const events = extractWaitEvents([{ title: 'page.waitForTimeout', duration: 5000 }] as any);
    expect(events.length).toBe(0);
  });

  it('extracts waits nested inside test.step() blocks', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const steps = [
      {
        title: 'test.step: fill form',
        category: 'test.step',
        startTime: start,
        duration: 2000,
        steps: [
          { title: 'locator.fill', duration: 200, steps: [] },
          { title: 'page.waitForTimeout', startTime: new Date(start.getTime() + 200), duration: 1000, steps: [] },
        ],
      },
    ];
    const events = extractWaitEvents(steps as any);
    expect(events.length).toBe(1);
    expect(events[0].title).toBe('page.waitForTimeout');
  });

  it('does NOT extract waits nested inside another wait step', () => {
    const start = new Date('2024-01-01T00:00:00.000Z');
    const steps = [
      {
        title: 'page.waitForResponse',
        startTime: start,
        duration: 3000,
        steps: [
          { title: 'page.waitForTimeout', startTime: new Date(start.getTime() + 100), duration: 500, steps: [] },
        ],
      },
    ];
    const events = extractWaitEvents(steps as any);
    expect(events.length).toBe(1); // only the outer wait
    expect(events[0].title).toBe('page.waitForResponse');
  });

  it('accepts numeric startTime', () => {
    const events = extractWaitEvents([{ title: 'page.waitForTimeout', startTime: 12345, duration: 100 }] as any);
    expect(events[0].startedAt).toBe(12345);
  });
});
