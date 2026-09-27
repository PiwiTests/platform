import { describe, test, expect } from 'vitest';
import { buildFailureTimeline } from '#shared/failure-timeline';
import type { PerformanceStep } from '~~/types/api';
import { buildStepTreeView, groupRowsBySection, sectionSummaryText } from '~/utils/timeline-rows';
import {
  afterAllFailure,
  beforeAllFailure,
  beforeEachFailure,
  bodyFailure,
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
