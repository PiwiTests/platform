import { describe, test, expect } from 'vitest';
import {
  useTimelineModel,
  computeLockSummary,
  type TimelineItem,
  type TimelineModelInput,
} from '../../app/composables/useTimelineModel';
import type { TestCaseResult, TestStepEvent } from '../../types/api';

type StepLike = Partial<TestStepEvent> & { title: string; category: string };
type CaseLike = {
  executionId: number;
  title: string;
  status: string;
  workerIndex: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  duration?: number | null;
  stepEvents?: StepLike[] | null;
  locks?: string[] | null;
};

/** Minimal test-kind timeline item for the pure lock-summary tests. */
function testItem(start: number, duration: number, locks: string[]): TimelineItem {
  return {
    key: `t${start}`,
    kind: 'test',
    testCaseId: start,
    title: `t${start}`,
    status: 'passed',
    workerIndex: 0,
    start,
    duration,
    rowIndex: 0,
    locks,
  };
}

function model(cases: CaseLike[], extra: Partial<TimelineModelInput> = {}) {
  return useTimelineModel({ testCases: cases as unknown as TestCaseResult[], ...extra });
}

describe('useTimelineModel', () => {
  test('positions bars by startedAt, renders hooks and only wasted waits', () => {
    const { timelineData, workerRows, maxTime } = model([
      {
        executionId: 1,
        title: 'A',
        status: 'passed',
        workerIndex: 0,
        startedAt: 1000,
        duration: 500,
        stepEvents: [
          { title: 'Before Hooks', category: 'hook', startedAt: 1000, duration: 100, status: 'passed' },
          { title: 'Wait for load state', category: 'wait', startedAt: 1100, duration: 50, status: 'passed' },
          { title: 'Wait for timeout', category: 'wait', startedAt: 1200, duration: 200, status: 'wasted' },
        ],
      },
      {
        executionId: 2,
        title: 'B',
        status: 'passed',
        workerIndex: 1,
        startedAt: 1000,
        duration: 400,
        stepEvents: null,
      },
    ]);

    const items = timelineData.value;
    // Two test bars, one hook, one wasted wait. The non-wasted "load state"
    // wait is dropped.
    expect(items.filter((d) => d.kind === 'test')).toHaveLength(2);
    expect(items.filter((d) => d.kind === 'hook')).toHaveLength(1);
    expect(items.filter((d) => d.kind === 'wait')).toHaveLength(1);
    expect(items.some((d) => d.title === 'Wait for load state')).toBe(false);

    const aBar = items.find((d) => d.key === 't1')!;
    expect(aBar.start).toBe(0); // anchored to the run's min startedAt
    expect(aBar.testCaseId).toBe(1);
    const wasted = items.find((d) => d.kind === 'wait')!;
    expect(wasted.start).toBe(200); // 1200 - 1000
    expect(wasted.duration).toBe(200);

    expect(workerRows.value).toHaveLength(2);
    expect(maxTime.value).toBe(500);
  });

  test('sequential fallback packs cases and waits when startedAt is absent', () => {
    const { timelineData, maxTime } = model([
      {
        executionId: 1,
        title: 'A',
        status: 'passed',
        workerIndex: 0,
        duration: 300,
        stepEvents: [{ title: 'Wait for timeout', category: 'wait', duration: 100, status: 'wasted' }],
      },
    ]);

    const items = timelineData.value;
    const bar = items.find((d) => d.kind === 'test')!;
    const wait = items.find((d) => d.kind === 'wait')!;
    expect(bar.start).toBe(0);
    expect(wait.start).toBe(300); // appended right after the test bar
    expect(maxTime.value).toBe(400);
  });

  test('groups rows into shards', () => {
    const { workerRows, shardGroups } = model([
      { executionId: 1, title: 'A', status: 'passed', workerIndex: 0, shardIndex: 0, startedAt: 1000, duration: 100 },
      { executionId: 2, title: 'B', status: 'passed', workerIndex: 0, shardIndex: 1, startedAt: 1000, duration: 100 },
    ]);

    expect(workerRows.value).toHaveLength(2);
    expect(shardGroups.value).toEqual([
      { shardIndex: 0, rowRange: [0, 0] },
      { shardIndex: 1, rowRange: [1, 1] },
    ]);
  });

  test('skips cases without a worker index', () => {
    const { timelineData, workerRows } = model([
      { executionId: 1, title: 'A', status: 'passed', workerIndex: null, startedAt: 1000, duration: 100 },
    ]);
    expect(timelineData.value).toHaveLength(0);
    expect(workerRows.value).toHaveLength(0);
  });

  test('flags suite setup steps and keeps the fixture kind distinct', () => {
    const { timelineData } = model(
      [
        {
          executionId: 1,
          title: 'A',
          status: 'passed',
          workerIndex: 0,
          startedAt: 1000,
          duration: 300,
          stepEvents: [
            { title: 'Before Hooks', category: 'hook', startedAt: 1000, duration: 40, status: 'passed' },
            { title: 'fixture: page', category: 'fixture', startedAt: 1040, duration: 30, status: 'passed' },
          ],
        },
      ],
      {
        setupSteps: [
          { title: 'beforeAll', category: 'hook', workerIndex: 0, startedAt: 1000, duration: 50, status: 'passed' },
        ] as unknown as TimelineModelInput['setupSteps'],
      },
    );

    const items = timelineData.value;
    const setup = items.find((d) => d.kind === 'setup');
    expect(setup?.title).toContain('[Setup]');
    expect(setup?.testCaseId).toBeNull();
    const fixture = items.find((d) => d.kind === 'fixture');
    expect(fixture?.title).toBe('fixture: page');
    const hook = items.find((d) => d.kind === 'hook');
    expect(hook?.title).toBe('Before Hooks');
  });

  test('honors a custom wasted-wait pattern', () => {
    const { timelineData } = model(
      [
        {
          executionId: 1,
          title: 'A',
          status: 'passed',
          workerIndex: 0,
          startedAt: 1000,
          duration: 300,
          stepEvents: [
            { title: 'Wait for response', category: 'wait', startedAt: 1050, duration: 80, status: 'passed' },
          ],
        },
      ],
      { wastedPatterns: ['Wait for response*'] },
    );
    expect(timelineData.value.filter((d) => d.kind === 'wait')).toHaveLength(1);
  });

  // Regression: step ids used to be derived as `-tc.id - stepIndex - 1`, so
  // adjacent test-case ids produced colliding ids (test 101 step 1 === test
  // 102 step 0). Colliding ids broke hover dimming (bars sharing the hovered
  // id stayed highlighted) and duplicated v-for keys.
  test('assigns a unique key to every item across tests with adjacent ids', () => {
    const steps: StepLike[] = [
      { title: 'Before Hooks', category: 'hook', startedAt: 1000, duration: 40, status: 'passed' },
      { title: 'Wait for timeout', category: 'wait', startedAt: 1100, duration: 100, status: 'wasted' },
      { title: 'After Hooks', category: 'hook', startedAt: 1300, duration: 30, status: 'passed' },
    ];
    const { timelineData } = model([
      {
        executionId: 101,
        title: 'A',
        status: 'passed',
        workerIndex: 0,
        startedAt: 1000,
        duration: 500,
        stepEvents: steps,
      },
      {
        executionId: 102,
        title: 'B',
        status: 'passed',
        workerIndex: 0,
        startedAt: 1600,
        duration: 500,
        stepEvents: steps,
      },
      {
        executionId: 103,
        title: 'C',
        status: 'passed',
        workerIndex: 1,
        startedAt: 1000,
        duration: 500,
        stepEvents: steps,
      },
    ]);

    const items = timelineData.value;
    expect(items).toHaveLength(12); // 3 tests × (1 bar + 2 hooks + 1 wait)
    const keys = items.map((d) => d.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  test('hook and wait segments carry their owning test case id', () => {
    const { timelineData } = model([
      {
        executionId: 7,
        title: 'A',
        status: 'passed',
        workerIndex: 0,
        startedAt: 1000,
        duration: 500,
        stepEvents: [
          { title: 'Before Hooks', category: 'hook', startedAt: 1000, duration: 40, status: 'passed' },
          { title: 'Wait for timeout', category: 'wait', startedAt: 1100, duration: 100, status: 'wasted' },
        ],
      },
    ]);

    for (const segment of timelineData.value.filter((d) => d.kind !== 'test')) {
      expect(segment.testCaseId).toBe(7);
      expect(segment.parentTitle).toBe('A');
    }
  });

  // Regression: setup items used to carry shardIndex null while sitting on a
  // real shard's row, which made the row list (then re-derived from items)
  // grow a phantom empty row per setup worker on sharded runs.
  test('sharded runs with setup steps do not grow phantom rows', () => {
    const { timelineData, workerRows, shardGroups } = model(
      [
        { executionId: 1, title: 'A', status: 'passed', workerIndex: 0, shardIndex: 1, startedAt: 1000, duration: 100 },
        { executionId: 2, title: 'B', status: 'passed', workerIndex: 0, shardIndex: 2, startedAt: 1000, duration: 100 },
      ],
      {
        setupSteps: [
          { title: 'beforeAll', category: 'hook', workerIndex: 0, startedAt: 1000, duration: 50, status: 'passed' },
        ] as unknown as TimelineModelInput['setupSteps'],
      },
    );

    expect(workerRows.value).toHaveLength(2);
    expect(shardGroups.value).toHaveLength(2);
    // The setup step lands on the first shard's row for that worker.
    expect(timelineData.value.find((d) => d.kind === 'setup')?.rowIndex).toBe(0);
  });

  test('ignores step categories that are not hooks, fixtures or waits', () => {
    const { timelineData } = model([
      {
        executionId: 1,
        title: 'A',
        status: 'passed',
        workerIndex: 0,
        startedAt: 1000,
        duration: 300,
        stepEvents: [
          { title: 'expect.toBe', category: 'expect', startedAt: 1010, duration: 5, status: 'passed' },
          { title: 'my step', category: 'test.step', startedAt: 1020, duration: 50, status: 'passed' },
        ],
      },
    ]);

    expect(timelineData.value).toHaveLength(1);
    expect(timelineData.value[0]!.kind).toBe('test');
  });

  test('exposes the run locks (sorted, distinct) and carries them onto test bars', () => {
    const { runLocks, timelineData } = model([
      {
        executionId: 1,
        title: 'A',
        status: 'passed',
        workerIndex: 0,
        startedAt: 1000,
        duration: 500,
        locks: ['db', 'api'],
      },
      { executionId: 2, title: 'B', status: 'passed', workerIndex: 1, startedAt: 1000, duration: 400, locks: ['db'] },
      { executionId: 3, title: 'C', status: 'passed', workerIndex: 0, startedAt: 1600, duration: 200, locks: null },
    ]);
    expect(runLocks.value).toEqual(['api', 'db']);
    expect(timelineData.value.find((d) => d.key === 't1')!.locks).toEqual(['db', 'api']);
    expect(timelineData.value.find((d) => d.key === 't3')!.locks).toBeNull();
  });
});

describe('computeLockSummary', () => {
  test('reports held time, share and back-to-back serialization per lock', () => {
    // Two holders of `db` run back-to-back (gap 0), one holder of `api` alone.
    const items = [testItem(0, 1000, ['db']), testItem(1000, 1000, ['db']), testItem(3000, 500, ['api'])];
    const summary = computeLockSummary(items, 4000);

    const db = summary.find((r) => r.lock === 'db')!;
    expect(db.testCount).toBe(2);
    expect(db.heldMs).toBe(2000); // merged 0..2000
    expect(db.share).toBeCloseTo(0.5);
    // The second holder started within 500ms of the first ending → serialized.
    expect(db.serializationMs).toBe(1000);

    const api = summary.find((r) => r.lock === 'api')!;
    expect(api.serializationMs).toBe(0); // a single holder never serializes

    // Ordered by held time descending.
    expect(summary[0]!.lock).toBe('db');
  });

  test('a gap over 500ms is not counted as serialization', () => {
    const items = [testItem(0, 1000, ['db']), testItem(2000, 1000, ['db'])];
    const summary = computeLockSummary(items, 4000);
    expect(summary[0]!.serializationMs).toBe(0);
  });

  test('flags a lock that dominates the run tail', () => {
    // Held across the whole final quarter (3000..4000) of a 4000ms run.
    const summary = computeLockSummary([testItem(2800, 1200, ['db'])], 4000);
    expect(summary[0]!.dominatesTail).toBe(true);
  });

  test('ignores non-test items and lock-less bars', () => {
    const hook: TimelineItem = { ...testItem(0, 100, ['db']), kind: 'hook' };
    const summary = computeLockSummary([hook, testItem(0, 100, [])], 1000);
    expect(summary).toHaveLength(0);
  });
});
