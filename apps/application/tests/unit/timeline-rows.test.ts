import { describe, test, expect } from 'vitest';
import { buildFailureTimeline } from '#shared/failure-timeline';
import type { PerformanceStep } from '~~/types/api';
import {
  MIN_BAR_PERCENT,
  barPlace,
  buildStepTreeView,
  groupRowsBySection,
  sectionSummaryText,
  testTrack,
  windowCutText,
  windowCuts,
} from '~/utils/timeline-rows';
import {
  afterAllFailure,
  beforeAllFailure,
  beforeEachFailure,
  bodyFailure,
  caughtProbeFailure,
  teardownAfterBodyFailure,
  type RecordedExecution,
} from '../../../../packages/core/tests/fixtures/playwright-steps';

const stepsOf = (execution: RecordedExecution) => execution.steps as unknown as PerformanceStep[];
const titleOf = (execution: RecordedExecution, index: number | null) =>
  index === null ? null : [execution.steps[index]!.title, execution.steps[index]!.subtitle].filter(Boolean).join(' ');

describe('buildStepTreeView', () => {
  test('finds the failing step inside a test.step and folds setup and teardown', () => {
    const view = buildStepTreeView(stepsOf(bodyFailure));
    expect(titleOf(bodyFailure, view.failingIndex)).toBe('Fill "ada@example.com" getByLabel(\'Email address\')');
    expect(view.sections.setup).toMatchObject({
      durationMs: 790,
      hooks: ['beforeAll', 'beforeEach'],
      failed: false,
    });
    expect(view.sections.setup!.fixtures).toEqual(['request', 'browser', 'context', 'page']);
    expect(view.sections.teardown).toMatchObject({ hooks: ['afterEach', 'afterAll'], failed: false });
  });

  test('never lists the capture’s own steps or the phase containers', () => {
    const view = buildStepTreeView(stepsOf(bodyFailure));
    const listed = bodyFailure.steps.filter((_, i) => !view.hidden.has(i)).map((s) => s.title);
    expect(listed).not.toContain('Before Hooks');
    expect(listed).not.toContain('After Hooks');
    expect(listed).not.toContain('Fixture "piwiCapture"');
    expect(listed.some((t) => t.startsWith('Attach "piwi-'))).toBe(false);
  });

  test('a test.step’s steps sit one level under it', () => {
    const view = buildStepTreeView(stepsOf(bodyFailure));
    const group = bodyFailure.steps.findIndex((s) => s.title === 'Fill contact details');
    expect(view.level[group]).toBe(0);
    expect(view.level[group + 1]).toBe(1);
    expect(view.groups.has(group)).toBe(true);
  });

  test('the failing row is the step that failed the test, and the probe it caught is recovered', () => {
    const view = buildStepTreeView(stepsOf(caughtProbeFailure), caughtProbeFailure.error);
    expect(titleOf(caughtProbeFailure, view.failingIndex)).toBe(
      "Expect \"toBeEnabled\" locator('.carousel').getByRole('link', { name: '' })",
    );
    const probe = caughtProbeFailure.steps.findIndex((s) => s.title === 'Expect "toBeVisible"');
    expect(view.roles[probe]).toBe('recovered');
    expect(view.roles[view.failingIndex!]).toBe('failing');
  });

  test('a caught error in a section does not mark it failed; a teardown failing after the body does', () => {
    const probeInSetup: PerformanceStep[] = [
      { title: 'Before Hooks', category: 'hook', duration: 20, depth: 0 } as PerformanceStep,
      {
        title: 'beforeEach hook',
        category: 'hook',
        duration: 10,
        failed: true,
        recovered: true,
        error: { message: 'Error: expect(locator).toBeVisible() failed' },
        depth: 1,
      } as PerformanceStep,
    ];
    expect(buildStepTreeView(probeInSetup, null).sections.setup?.failed).toBe(false);
    const view = buildStepTreeView(stepsOf(teardownAfterBodyFailure), teardownAfterBodyFailure.error);
    expect(view.phases[view.failingIndex!]).toBe('body');
    expect(view.sections.teardown?.failed).toBe(true);
  });

  test('marks the section a hook failure happened in', () => {
    expect(buildStepTreeView(stepsOf(beforeEachFailure)).sections.setup?.failed).toBe(true);
    expect(buildStepTreeView(stepsOf(beforeAllFailure)).sections.setup?.failed).toBe(true);
    expect(buildStepTreeView(stepsOf(afterAllFailure)).sections.teardown?.failed).toBe(true);
    expect(buildStepTreeView(stepsOf(afterAllFailure)).sections.setup?.failed).toBe(false);
  });
});

describe('sectionSummaryText', () => {
  test('names the hooks, and the fixtures by name or by count', () => {
    expect(sectionSummaryText({ durationMs: 1, hooks: ['beforeAll'], fixtures: ['request'], failed: false })).toBe(
      'beforeAll · fixture request',
    );
    expect(
      sectionSummaryText({ durationMs: 1, hooks: [], fixtures: ['browser', 'context', 'page'], failed: false }),
    ).toBe('3 fixtures');
  });
});

describe('groupRowsBySection', () => {
  test('keeps consecutive rows of one section together, other rows join the step before them', () => {
    const rows = [
      { id: 'a', phase: 'setup' as const },
      { id: 'net', phase: null },
      { id: 'b', phase: 'body' as const },
      { id: 'c', phase: 'body' as const },
      { id: 'd', phase: 'teardown' as const },
    ];
    const blocks = groupRowsBySection(rows, (r) => r.phase);
    expect(blocks.map((b) => [b.section, b.rows.map((r) => r.id)])).toEqual([
      ['setup', ['a', 'net']],
      ['body', ['b', 'c']],
      ['teardown', ['d']],
    ]);
  });

  test('a leading non-step row joins the first section', () => {
    const blocks = groupRowsBySection(
      [
        { id: 'net', phase: null },
        { id: 'b', phase: 'body' as const },
      ],
      (r) => r.phase,
    );
    expect(blocks).toHaveLength(1);
    expect(blocks[0]!.section).toBe('body');
  });
});

describe('buildFailureTimeline with hooks and fixtures', () => {
  const timelineOf = (execution: RecordedExecution) =>
    buildFailureTimeline({
      startedAt: execution.steps[0]!.startTime,
      duration: 4_000,
      status: execution.status,
      steps: execution.steps,
    });

  test('anchors the failure on the innermost failing step', () => {
    const tl = timelineOf(beforeEachFailure);
    expect(tl.failedStep?.label).toBe("Click getByRole('button', { name: 'Edit profile' })");
  });

  test('leaves the capture’s own steps and the phase containers off the steps lane', () => {
    const labels = timelineOf(bodyFailure).lanes.steps.map((s) => s.label);
    expect(labels).not.toContain('Before Hooks');
    expect(labels.some((l) => l.startsWith('Attach "piwi-'))).toBe(false);
    expect(labels).toContain('Fill contact details');
  });

  test('a test.step groups the actions inside it', () => {
    const fill = timelineOf(bodyFailure).lanes.steps.find((s) => s.label.includes("getByLabel('Email address')"));
    expect(fill?.group).toBe('Fill contact details');
  });
});

describe('buildFailureTimeline with an error the test caught', () => {
  /** The reproduction, the failing step 30 s after the probe, as on a real suite. */
  const later = (() => {
    const probeEnd = caughtProbeFailure.steps.findIndex((s) => s.title === 'Expect "toBeVisible"');
    return caughtProbeFailure.steps.map((step, i) =>
      i > probeEnd ? { ...step, startTime: step.startTime + 30_000 } : step,
    );
  })();
  const timeline = () =>
    buildFailureTimeline({
      startedAt: later[0]!.startTime,
      duration: 31_000,
      status: 'failed',
      error: caughtProbeFailure.error,
      steps: later,
    });

  test('anchors the failure and the window on the step that failed the test, not on the probe', () => {
    const tl = timeline();
    expect(tl.failedStep?.label).toBe("Expect \"toBeEnabled\" locator('.carousel').getByRole('link', { name: '' })");
    const fatal = tl.lanes.steps.find((s) => s.failed)!;
    expect(fatal.label).toBe(tl.failedStep!.label);
    expect(tl.failureAt).toBe(fatal.at + (fatal.duration ?? 0));
    expect(tl.window.start).toBeLessThanOrEqual(fatal.at);
    expect(tl.window.end).toBeGreaterThanOrEqual(fatal.at + (fatal.duration ?? 0));
    const probe = tl.lanes.steps.find((s) => s.label.includes('toBeVisible'))!;
    expect(probe.failed).toBeUndefined();
    expect(probe.at).toBeLessThan(tl.window.start);
  });
});

describe('duration bars on the test clock', () => {
  const T0 = 1_700_000_000_000;
  /** A 4.4 s test whose 3 s click fails, plus whatever evidence `extra` adds. */
  const timeline = (extra: { consoleAt?: number; request?: { at: number; duration: number } } = {}) =>
    buildFailureTimeline({
      startedAt: T0,
      duration: 4_400,
      status: 'failed',
      steps: [
        { title: 'goto /checkout', category: 'pw:api', duration: 1_400, startTime: T0 },
        { title: 'click Pay', category: 'pw:api', duration: 3_000, startTime: T0 + 1_400, error: 'timed out' },
      ],
      consoleLogs:
        extra.consoleAt != null ? [{ type: 'log', text: 'early', timestamp: T0 + extra.consoleAt, location: 'x' }] : [],
      networkRequests: extra.request
        ? [
            {
              method: 'POST',
              url: '/api/checkout/quote',
              status: 200,
              duration: extra.request.duration,
              startTime: T0 + extra.request.at,
            },
          ]
        : [],
    });
  const stepBars = (tl: ReturnType<typeof timeline>) => {
    const track = testTrack(tl, 4_400);
    return tl.lanes.steps.map((step) => barPlace(step.at, step.duration, track));
  };

  test('places each step from the test start, as a share of the test', () => {
    const [goto, click] = stepBars(timeline());
    expect(goto!.left).toBe(0);
    expect(goto!.width).toBeCloseTo(31.8, 1);
    expect(click!.left).toBeCloseTo(31.8, 1);
    expect(click!.width).toBeCloseTo(68.2, 1);
  });

  test('evidence stamped before the test started leaves the step bars where they are', () => {
    const plain = stepBars(timeline());
    for (const before of [-3_000, -10_000]) {
      const tl = timeline({ consoleAt: before });
      expect(tl.testStart).toBe(-before);
      const bars = stepBars(tl);
      bars.forEach((bar, i) => {
        expect(bar.left).toBeCloseTo(plain[i]!.left, 6);
        expect(bar.width).toBeCloseTo(plain[i]!.width, 6);
      });
      // The early entry itself sits at the start of the track, never before it.
      const early = barPlace(tl.lanes.console[0]!.at, null, testTrack(tl, 4_400));
      expect(early).toEqual({ left: 0, width: MIN_BAR_PERCENT });
    }
  });

  test('a request that outlasts the test runs to the end of its track', () => {
    const tl = timeline({ request: { at: 1_000, duration: 28_400 } });
    const bar = barPlace(tl.lanes.network[0]!.at, tl.lanes.network[0]!.duration, testTrack(tl, 4_400));
    expect(bar.left).toBeCloseTo((1_000 / 4_400) * 100, 6);
    expect(bar.left + bar.width).toBe(100);
  });

  test('without a test duration, the track runs from the test start to the timeline end', () => {
    const tl = timeline({ consoleAt: -3_000 });
    expect(testTrack(tl, null)).toEqual({ start: 3_000, length: tl.end - tl.origin - 3_000 });
  });

  test('a short bar keeps its minimum width, even at the end of the track', () => {
    expect(barPlace(0, 0, { start: 0, length: 10_000 })).toEqual({ left: 0, width: MIN_BAR_PERCENT });
    expect(barPlace(10_000, 0, { start: 0, length: 10_000 })).toEqual({
      left: 100 - MIN_BAR_PERCENT,
      width: MIN_BAR_PERCENT,
    });
  });
});

describe('window cuts', () => {
  const window = { start: 1_000, end: 2_000 };

  test('names the edges of the window a bar crosses', () => {
    expect(windowCuts({ at: 1_200, duration: 300 }, window)).toEqual({ start: false, end: false });
    expect(windowCuts({ at: 500, duration: 1_000 }, window)).toEqual({ start: true, end: false });
    expect(windowCuts({ at: 1_500, duration: 1_000 }, window)).toEqual({ start: false, end: true });
    expect(windowCuts({ at: 500, duration: 5_000 }, window)).toEqual({ start: true, end: true });
    expect(windowCuts({ at: 1_500 }, window)).toEqual({ start: false, end: false });
  });

  test('the tooltip says both when the window cuts a bar on both sides', () => {
    expect(windowCutText({ start: false, end: false })).toBeNull();
    expect(windowCutText({ start: true, end: false })).toBe('Started before this window');
    expect(windowCutText({ start: false, end: true })).toBe('Runs on past this window');
    expect(windowCutText({ start: true, end: true })).toBe('Started before and runs on past this window');
  });
});
