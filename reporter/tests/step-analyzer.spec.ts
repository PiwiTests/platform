import { describe, it } from 'node:test';
import * as assert from 'node:assert/strict';
import {
  categorizeStep,
  flattenSteps,
  collectStepMetrics,
  percentile,
  computePerformanceSummary,
  extractTestStepEvents,
} from '../src/step-analyzer.js';

describe('categorizeStep', () => {
  it('returns "other" for empty title', () => {
    assert.equal(categorizeStep(''), 'other');
  });

  it('passes through hook/fixture pwCategory verbatim', () => {
    assert.equal(categorizeStep('Before Hooks', 'hook'), 'hook');
    assert.equal(categorizeStep('fixture: browser', 'fixture'), 'fixture');
  });

  it('classifies navigation steps', () => {
    assert.equal(categorizeStep('page.goto'), 'navigation');
    assert.equal(categorizeStep('Page.goto'), 'navigation');
    assert.equal(categorizeStep('page.reload'), 'navigation');
    assert.equal(categorizeStep('page.goBack'), 'navigation');
    assert.equal(categorizeStep('page.goForward'), 'navigation');
  });

  it('classifies action steps', () => {
    assert.equal(categorizeStep('locator.click'), 'action');
    assert.equal(categorizeStep('locator.dblclick'), 'action');
    assert.equal(categorizeStep('locator.check'), 'action');
    assert.equal(categorizeStep('locator.uncheck'), 'action');
    assert.equal(categorizeStep('locator.selectOption'), 'action');
    assert.equal(categorizeStep('locator.tap'), 'action');
  });

  it('classifies input steps', () => {
    assert.equal(categorizeStep('locator.fill'), 'input');
    assert.equal(categorizeStep('locator.type'), 'input');
    assert.equal(categorizeStep('locator.press'), 'input');
    assert.equal(categorizeStep('locator.clear'), 'input');
    assert.equal(categorizeStep('locator.setInputFiles'), 'input');
  });

  it('classifies assertions', () => {
    assert.equal(categorizeStep('expect.toBeVisible'), 'assertion');
    assert.equal(categorizeStep('locator.expect.toBeVisible'), 'assertion');
    assert.equal(categorizeStep('page.expect'), 'assertion');
  });

  it('classifies wait steps', () => {
    assert.equal(categorizeStep('locator.waitFor'), 'wait');
    assert.equal(categorizeStep('page.waitFor'), 'wait');
    assert.equal(categorizeStep('page.waitForLoadState'), 'wait');
    assert.equal(categorizeStep('page.waitForURL'), 'wait');
  });

  it('classifies api steps', () => {
    assert.equal(categorizeStep('apiRequestContext.get'), 'api');
    assert.equal(categorizeStep('apiResponse'), 'api');
  });

  it('classifies hook phrases', () => {
    assert.equal(categorizeStep('Before Hooks'), 'hook');
    assert.equal(categorizeStep('After Hooks'), 'hook');
    assert.equal(categorizeStep('fixture: browser'), 'hook');
  });

  it('returns "other" for unknown titles', () => {
    assert.equal(categorizeStep('someCustomStep'), 'other');
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
    assert.equal(flat.length, 5);
    assert.deepEqual(
      flat.map((s) => s.title),
      ['page.goto', 'locator.click', 'expect.toBe', 'inner', 'outer'],
    );
    assert.equal(flat[0].category, 'navigation');
    assert.equal(flat[1].category, 'action');
    assert.equal(flat[2].category, 'assertion');
    assert.equal(flat[3].category, 'other');
  });

  it('handles empty input', () => {
    assert.deepEqual(flattenSteps([]), []);
  });

  it('preserves durations', () => {
    const flat = flattenSteps([{ title: 'x', duration: 42, steps: [] }] as any);
    assert.equal(flat[0].duration, 42);
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
    assert.equal(m.steps.length, 3);
    assert.equal(m.totalStepDuration, 230);
    assert.deepEqual(m.slowestStep, { title: 'page.goto', duration: 100 });
    assert.equal(m.navigationCount, 2);
    assert.equal(m.navigationTotalDuration, 180);
  });

  it('returns null slowestStep when there are no flat steps', () => {
    const m = collectStepMetrics([] as any);
    assert.equal(m.slowestStep, null);
    assert.equal(m.totalStepDuration, 0);
    assert.equal(m.navigationCount, 0);
  });

  it('totalStepDuration sums top-level only (nested not double-counted)', () => {
    const steps = [
      { title: 'outer', duration: 100, steps: [{ title: 'inner', duration: 50, steps: [] }] },
    ];
    const m = collectStepMetrics(steps as any);
    assert.equal(m.totalStepDuration, 100); // reduce over top-level only
  });
});

describe('percentile', () => {
  it('returns 0 for empty array', () => {
    assert.equal(percentile([], 50), 0);
  });

  it('computes p50, p90, p95 on a sorted array', () => {
    const sorted = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
    // index = ceil(p/100 * n) - 1
    // p50: ceil(5) - 1 = 4 -> 5
    // p90: ceil(9) - 1 = 8 -> 9
    // p95: ceil(9.5) - 1 = 9 -> 10
    assert.equal(percentile(sorted, 50), 5);
    assert.equal(percentile(sorted, 90), 9);
    assert.equal(percentile(sorted, 95), 10);
  });

  it('clamps index to 0 for low percentiles', () => {
    assert.equal(percentile([42], 10), 42);
    assert.equal(percentile([42], 1), 42);
  });
});

describe('computePerformanceSummary', () => {
  it('returns empty object when no test cases have durations', () => {
    assert.deepEqual(computePerformanceSummary([]), {});
    assert.deepEqual(computePerformanceSummary([{ duration: null }]), {});
  });

  it('computes averages, percentiles, and slowest tests', () => {
    const cases = [
      { title: 'a', duration: 100 },
      { title: 'b', duration: 200 },
      { title: 'c', duration: 300 },
    ];
    const s = computePerformanceSummary(cases as any);
    assert.equal(s.avgTestDuration, 200);
    assert.equal(s.p50TestDuration, 200);
    assert.equal(s.p90TestDuration, 300);
    assert.equal(s.p95TestDuration, 300);
    assert.deepEqual(s.slowestTests, [
      { title: 'c', duration: 300 },
      { title: 'b', duration: 200 },
      { title: 'a', duration: 100 },
    ]);
  });

  it('caps slowest tests at 5', () => {
    const cases = Array.from({ length: 10 }, (_, i) => ({ title: `t${i}`, duration: i * 10 }));
    const s = computePerformanceSummary(cases as any);
    assert.equal(s.slowestTests?.length, 5);
    assert.equal(s.slowestTests?.[0].title, 't9');
  });

  it('aggregates navigation stats from performanceMetrics', () => {
    const cases = [
      { title: 'a', duration: 100, performanceMetrics: { navigationTotalDuration: 50, navigationCount: 2 } },
      { title: 'b', duration: 200, performanceMetrics: { navigationTotalDuration: 30, navigationCount: 3 } },
    ];
    const s = computePerformanceSummary(cases as any);
    assert.equal(s.totalNavigationDuration, 80);
    assert.equal(s.avgNavigationDuration, Math.round(80 / 5));
  });

  it('avgNavigationDuration is 0 when no navigation steps', () => {
    const s = computePerformanceSummary([{ title: 'a', duration: 100 }] as any);
    assert.equal(s.avgNavigationDuration, 0);
    assert.equal(s.totalNavigationDuration, 0);
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
    assert.equal(events.length, 2);
    assert.equal(events[0].title, 'Before Hooks');
    assert.equal(events[0].category, 'hook');
    assert.equal(events[0].startedAt, start.getTime());
    assert.equal(events[0].status, 'passed');
    assert.equal(events[0].location, 'a.ts:1:2');
    assert.equal(events[1].status, 'failed'); // error present
  });

  it('skips steps without startTime', () => {
    const events = extractTestStepEvents([{ title: 'Before Hooks', category: 'hook', duration: 1 }] as any, new Date());
    assert.equal(events.length, 0);
  });

  it('accepts numeric startTime (passes through)', () => {
    const events = extractTestStepEvents(
      [{ title: 'Before Hooks', category: 'hook', startTime: 12345, duration: 1 }] as any,
      new Date(),
    );
    assert.equal(events[0].startedAt, 12345);
  });
});
