import { describe, test, expect } from 'vitest';
import {
  failingStepIndex,
  failureHookContext,
  isCaptureStep,
  isPhaseContainer,
  stepParents,
  stepPhases,
  type TreeStepLike,
} from '../src/step-tree';
import { categorizeStep, flattenSteps } from '../src/step-analysis';
import {
  afterAllFailure,
  beforeAllFailure,
  beforeEachFailure,
  bodyFailure,
  type RecordedStep,
} from './fixtures/playwright-steps';

const titleAt = (steps: RecordedStep[], index: number | null) =>
  index === null ? null : [steps[index]!.title, steps[index]!.subtitle].filter(Boolean).join(' ');

/** The same steps without the recorded depth, as a reporter that predates it stored them. */
const withoutDepth = (steps: RecordedStep[]): TreeStepLike[] => steps.map(({ depth: _depth, ...rest }) => rest);

describe('stepParents', () => {
  test('rebuilds the tree from each step’s depth', () => {
    const parents = stepParents(bodyFailure.steps);
    const index = (title: string) => bodyFailure.steps.findIndex((s) => s.title === title);
    expect(parents[index('Before Hooks')]).toBe(-1);
    expect(parents[index('beforeAll hook')]).toBe(index('Before Hooks'));
    expect(parents[index('Sign in as Ada')]).toBe(index('beforeEach hook'));
    expect(parents[index('Fill contact details')]).toBe(-1);
    expect(parents[index('Fill contact details') + 1]).toBe(index('Fill contact details'));
  });

  test('without a depth, start times and durations give the same phases and failing step', () => {
    for (const execution of [bodyFailure, beforeEachFailure, beforeAllFailure, afterAllFailure]) {
      const timed = withoutDepth(execution.steps);
      expect(stepPhases(timed)).toEqual(stepPhases(execution.steps));
      expect(failingStepIndex(timed)).toBe(failingStepIndex(execution.steps));
    }
  });

  test('without a depth, a step inside another’s span is its child', () => {
    const parents = stepParents(withoutDepth(bodyFailure.steps));
    const index = (title: string) => bodyFailure.steps.findIndex((s) => s.title === title);
    expect(parents[index('Sign in as Ada')]).toBe(index('beforeEach hook'));
    expect(parents[index('Fill contact details') + 1]).toBe(index('Fill contact details'));
  });

  test('without a depth or times, every step is top level', () => {
    expect(stepParents([{ title: 'a' }, { title: 'b' }])).toEqual([-1, -1]);
  });
});

describe('stepPhases', () => {
  test('splits setup, the test body and teardown', () => {
    const phases = stepPhases(bodyFailure.steps);
    const phaseOf = (title: string) => phases[bodyFailure.steps.findIndex((s) => s.title === title)];
    expect(phaseOf('Before Hooks')).toBe('setup');
    expect(phaseOf('Sign in as Ada')).toBe('setup');
    expect(phaseOf('Launch browser')).toBe('setup');
    expect(phaseOf('Open checkout')).toBe('body');
    expect(phaseOf('Fill contact details')).toBe('body');
    expect(phaseOf('afterEach hook')).toBe('teardown');
    expect(phaseOf('afterAll hook')).toBe('teardown');
    expect(phaseOf('Worker Cleanup')).toBe('teardown');
  });
});

describe('failingStepIndex', () => {
  test('is the innermost step of the failing chain, not the test.step around it', () => {
    expect(titleAt(bodyFailure.steps, failingStepIndex(bodyFailure.steps))).toBe(
      'Fill "ada@example.com" getByLabel(\'Email address\')',
    );
  });

  test('finds the failing action inside a beforeEach hook, not "Before Hooks"', () => {
    expect(titleAt(beforeEachFailure.steps, failingStepIndex(beforeEachFailure.steps))).toBe(
      "Click getByRole('button', { name: 'Edit profile' })",
    );
  });

  test('finds the failing assertion inside a beforeAll and an afterAll hook', () => {
    expect(titleAt(beforeAllFailure.steps, failingStepIndex(beforeAllFailure.steps))).toBe(
      'seeding the report fixtures',
    );
    expect(titleAt(afterAllFailure.steps, failingStepIndex(afterAllFailure.steps))).toBe('cleanup endpoint');
  });

  test('works from start times alone', () => {
    expect(titleAt(beforeEachFailure.steps, failingStepIndex(withoutDepth(beforeEachFailure.steps)))).toBe(
      "Click getByRole('button', { name: 'Edit profile' })",
    );
  });

  test('never picks a capture probe that was cut off by the end of the test', () => {
    const steps: TreeStepLike[] = [
      {
        title: 'Evaluate',
        category: 'other',
        depth: 0,
        failed: true,
        error: { message: 'locator.evaluate: Test ended.' },
        location: '/work/shop/node_modules/@piwitests/reporter/dist/index.js:7770:17',
      },
      { title: 'Click', category: 'action', depth: 0, failed: true, error: { message: 'Timeout' } },
    ];
    expect(failingStepIndex(steps)).toBe(1);
  });

  test('is null when no step failed', () => {
    expect(failingStepIndex([{ title: 'a' }, { title: 'b' }])).toBeNull();
  });
});

describe('failureHookContext', () => {
  test('is null for a failure in the test body', () => {
    expect(failureHookContext(bodyFailure.steps, bodyFailure.error)).toBeNull();
  });

  test('names the hook a setup or teardown failure happened in', () => {
    expect(failureHookContext(beforeEachFailure.steps, beforeEachFailure.error)).toEqual({
      phase: 'setup',
      hook: 'beforeEach',
    });
    expect(failureHookContext(beforeAllFailure.steps, beforeAllFailure.error)).toEqual({
      phase: 'setup',
      hook: 'beforeAll',
    });
    expect(failureHookContext(afterAllFailure.steps, afterAllFailure.error)).toEqual({
      phase: 'teardown',
      hook: 'afterAll',
    });
  });

  test('names a fixture, and a hook with its own title', () => {
    const steps: TreeStepLike[] = [
      { title: 'Before Hooks', category: 'hook', depth: 0, failed: true, error: { message: 'Error: db down' } },
      { title: 'Fixture "db"', category: 'fixture', depth: 1, failed: true, error: { message: 'Error: db down' } },
    ];
    expect(failureHookContext(steps, 'Error: db down')).toEqual({ phase: 'setup', hook: 'fixture "db"' });

    const named: TreeStepLike[] = [
      { title: 'Before Hooks', category: 'hook', depth: 0, failed: true, error: { message: 'Error: x' } },
      { title: 'seed the catalog', category: 'hook', depth: 1, failed: true, error: { message: 'Error: x' } },
    ];
    expect(failureHookContext(named, 'Error: x')).toEqual({ phase: 'setup', hook: 'hook "seed the catalog"' });
  });

  test('is null when the failing hook step does not carry the execution’s own error', () => {
    expect(failureHookContext(afterAllFailure.steps, 'Error: something else in the test body')).toBeNull();
  });
});

describe('isCaptureStep', () => {
  test('recognizes the capture’s attachments and its probes through the reporter bundle', () => {
    expect(isCaptureStep({ title: 'Attach "piwi-locators"' })).toBe(true);
    expect(isCaptureStep({ title: 'Fixture "piwiCapture"', category: 'fixture' })).toBe(true);
    expect(isCaptureStep({ title: 'Fixture "page"', category: 'fixture' })).toBe(false);
    expect(isCaptureStep({ title: 'Attach "screenshot"' })).toBe(false);
    expect(
      isCaptureStep({
        title: 'Evaluate',
        location: '/ci/work/node_modules/@piwitests/reporter/dist/index.js:7770:17',
      }),
    ).toBe(true);
    expect(isCaptureStep({ title: 'Evaluate', location: '/ci/work/tests/checkout.spec.ts:22:16' })).toBe(false);
  });
});

describe('isPhaseContainer', () => {
  test('recognizes Playwright’s phase containers only', () => {
    expect(isPhaseContainer({ title: 'Before Hooks' })).toBe(true);
    expect(isPhaseContainer({ title: 'After Hooks' })).toBe(true);
    expect(isPhaseContainer({ title: 'Worker Cleanup' })).toBe(true);
    expect(isPhaseContainer({ title: 'beforeEach hook' })).toBe(false);
  });
});

describe('flattenSteps and categorizeStep', () => {
  test('flattening records each step’s depth', () => {
    const flat = flattenSteps([
      {
        title: 'Before Hooks',
        category: 'hook',
        duration: 5,
        steps: [{ title: 'beforeEach hook', category: 'hook', duration: 4 }],
      },
      {
        title: 'Open checkout',
        category: 'test.step',
        duration: 3,
        steps: [{ title: 'Click', category: 'pw:api', duration: 2 }],
      },
    ]);
    expect(flat.map((s) => [s.title, s.depth])).toEqual([
      ['Before Hooks', 0],
      ['beforeEach hook', 1],
      ['Open checkout', 0],
      ['Click', 1],
    ]);
  });

  test('a test.step is a group whatever its title, an API request is api, an attachment is attach', () => {
    expect(categorizeStep('Fill contact details', 'test.step')).toBe('test.step');
    expect(categorizeStep('POST', 'pw:api', { url: '/api/seed', method: 'POST' })).toBe('api');
    expect(categorizeStep('Navigate', 'pw:api', { url: '/login' })).toBe('navigation');
    expect(categorizeStep('Attach "trace"', 'test.attach')).toBe('attach');
  });
});
