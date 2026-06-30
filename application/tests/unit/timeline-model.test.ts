import { describe, test, expect } from 'vitest';
import { useTimelineModel, type TimelineModelInput } from '../../app/composables/useTimelineModel';
import type { TestCaseResult, TestStepEvent } from '../../types/api';

type StepLike = Partial<TestStepEvent> & { title: string; category: string };
type CaseLike = {
  id: number;
  title: string;
  status: string;
  workerIndex: number | null;
  shardIndex?: number | null;
  startedAt?: number | null;
  duration?: number | null;
  stepEvents?: StepLike[] | null;
};

function model(cases: CaseLike[], extra: Partial<TimelineModelInput> = {}) {
  return useTimelineModel({ testCases: cases as unknown as TestCaseResult[], ...extra });
}

describe('useTimelineModel', () => {
  test('positions bars by startedAt, renders hooks and only wasted waits', () => {
    const { timelineData, workerRows, maxTime } = model([
      {
        id: 1,
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
      { id: 2, title: 'B', status: 'passed', workerIndex: 1, startedAt: 1000, duration: 400, stepEvents: null },
    ]);

    const items = timelineData.value;
    // Two test bars, one hook, one wasted wait. The non-wasted "load state"
    // wait is dropped.
    expect(items.filter((d) => !d.isHook && !d.isWait)).toHaveLength(2);
    expect(items.filter((d) => d.isHook)).toHaveLength(1);
    expect(items.filter((d) => d.isWait)).toHaveLength(1);
    expect(items.some((d) => d.title === 'Wait for load state')).toBe(false);

    const aBar = items.find((d) => d.id === 1)!;
    expect(aBar.start).toBe(0); // anchored to the run's min startedAt
    const wasted = items.find((d) => d.isWait)!;
    expect(wasted.start).toBe(200); // 1200 - 1000
    expect(wasted.duration).toBe(200);

    expect(workerRows.value).toHaveLength(2);
    expect(maxTime.value).toBe(500);
  });

  test('sequential fallback packs cases and waits when startedAt is absent', () => {
    const { timelineData, maxTime } = model([
      {
        id: 1,
        title: 'A',
        status: 'passed',
        workerIndex: 0,
        duration: 300,
        stepEvents: [{ title: 'Wait for timeout', category: 'wait', duration: 100, status: 'wasted' }],
      },
    ]);

    const items = timelineData.value;
    const bar = items.find((d) => !d.isWait)!;
    const wait = items.find((d) => d.isWait)!;
    expect(bar.start).toBe(0);
    expect(wait.start).toBe(300); // appended right after the test bar
    expect(maxTime.value).toBe(400);
  });

  test('groups rows into shards', () => {
    const { workerRows, shardGroups } = model([
      { id: 1, title: 'A', status: 'passed', workerIndex: 0, shardIndex: 0, startedAt: 1000, duration: 100 },
      { id: 2, title: 'B', status: 'passed', workerIndex: 0, shardIndex: 1, startedAt: 1000, duration: 100 },
    ]);

    expect(workerRows.value).toHaveLength(2);
    expect(shardGroups.value).toEqual([
      { shardIndex: 0, rowRange: [0, 0] },
      { shardIndex: 1, rowRange: [1, 1] },
    ]);
  });

  test('skips cases without a worker index', () => {
    const { timelineData, workerRows } = model([
      { id: 1, title: 'A', status: 'passed', workerIndex: null, startedAt: 1000, duration: 100 },
    ]);
    expect(timelineData.value).toHaveLength(0);
    expect(workerRows.value).toHaveLength(0);
  });

  test('honors a custom wasted-wait pattern', () => {
    const { timelineData } = model(
      [
        {
          id: 1,
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
    expect(timelineData.value.filter((d) => d.isWait)).toHaveLength(1);
  });
});
