import { test, expect } from 'vitest';
import { stepLabel } from '@piwitests/core/step-analysis';
import { liveStepForCase, type LiveStepsByWorker } from '../../app/utils/live-steps';
import type { TestCaseResult } from '../../types/api';

function makeCase(overrides: Partial<TestCaseResult>): TestCaseResult {
  return {
    executionId: 1,
    testCaseId: 1,
    title: 'checkout completes',
    status: 'running',
    location: 'tests/checkout.spec.ts:5:3',
    workerIndex: 0,
    ...overrides,
  } as TestCaseResult;
}

const steps: LiveStepsByWorker = {
  0: { title: 'click "Pay now"', category: 'pw:api', parentTitle: 'checkout completes' },
  1: { title: 'expect(page).toHaveURL(...)', category: 'pw:expect', status: 'passed', parentTitle: 'catalog filters' },
};

test('matches the running row to its worker step', () => {
  expect(liveStepForCase(steps, makeCase({}))?.title).toBe('click "Pay now"');
});

test('only running rows show a step', () => {
  expect(liveStepForCase(steps, makeCase({ status: 'passed' }))).toBeNull();
  expect(liveStepForCase(steps, makeCase({ status: 'failed' }))).toBeNull();
});

test('rows without a worker, and workers without a step, show nothing', () => {
  expect(liveStepForCase(steps, makeCase({ workerIndex: null }))).toBeNull();
  expect(liveStepForCase(steps, makeCase({ workerIndex: 7 }))).toBeNull();
  expect(liveStepForCase(null, makeCase({}))).toBeNull();
  expect(liveStepForCase(undefined, makeCase({}))).toBeNull();
});

test('a lingering step from the previous test never surfaces on the next row', () => {
  // Worker 1's last step belongs to "catalog filters"; a new test began on
  // that worker but its first step has not arrived yet.
  const next = makeCase({ title: 'catalog sorts by price', workerIndex: 1 });
  expect(liveStepForCase(steps, next)).toBeNull();
  // The step still shows on the row it belongs to (same worker, same title).
  const owner = makeCase({ title: 'catalog filters', workerIndex: 1 });
  expect(liveStepForCase(steps, owner)?.status).toBe('passed');
});

test('a step with no parent title falls back to the worker match', () => {
  const anonymous: LiveStepsByWorker = { 0: { title: 'fixture: context', category: 'fixture' } };
  expect(liveStepForCase(anonymous, makeCase({}))?.title).toBe('fixture: context');
});

test('a live step keeps its subtitle, and the label composes both', () => {
  const withSubtitle: LiveStepsByWorker = {
    0: {
      title: 'Click',
      subtitle: "getByRole('button', { name: 'Pay' })",
      category: 'pw:api',
      parentTitle: 'checkout completes',
    },
  };
  const live = liveStepForCase(withSubtitle, makeCase({}));
  expect(live?.subtitle).toBe("getByRole('button', { name: 'Pay' })");
  expect(stepLabel(live!)).toBe("Click getByRole('button', { name: 'Pay' })");
});
