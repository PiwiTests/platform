import { computed, type ComputedRef } from 'vue';
import type { TestCaseResult, TestStepEvent } from '~~/types/api';
import { isWastedWait, DEFAULT_WASTED_WAIT_PATTERNS } from '#shared/utils/wasted-waits';

/** A single drawable element on the timeline: a test bar, hook/fixture, or wait. */
export interface TimelineItem {
  id: number;
  title: string;
  status: string;
  workerIndex: number;
  shardIndex: number | null;
  start: number;
  duration: number;
  rowIndex: number;
  isHook: boolean;
  isWait: boolean;
  /** Suite-level setup step (beforeAll/afterAll), rendered with a `[Setup]` prefix. */
  isSetup?: boolean;
  category?: string;
  parentTitle?: string | null;
}

/** Shard group for rendering separators and labels. */
export interface ShardGroup {
  shardIndex: number | null;
  /** Row indices (0-based) within this shard's worker rows. */
  rowRange: [number, number];
}

/** Inputs the model derives its rows from (a subset of the component props). */
export interface TimelineModelInput {
  testCases: TestCaseResult[];
  setupSteps?: TestStepEvent[] | null;
  /** Allowlist of glob patterns classifying which waits count as wasted time. */
  wastedPatterns?: string[] | null;
}

/**
 * Group test cases by (shardIndex, workerIndex) — two shards may have
 * overlapping worker indices (e.g. both Shard 1 and Shard 2 have Worker 0).
 * Falls back to workerIndex-only grouping when no shard info is present.
 */
type WorkerKey = string; // "shardIndex|workerIndex" or "null|workerIndex"

function workerKey(tc: TestCaseResult): WorkerKey | null {
  const w = tc.workerIndex;
  if (w == null || w < 0) return null;
  return `${tc.shardIndex ?? 'null'}|${w}`;
}

/**
 * Coerce a `startedAt` value to epoch milliseconds. Timestamps are numeric ms
 * end-to-end now (live SSE, REST, and both DB backends), so this is just a
 * finite-number guard. The Date/string fallbacks remain only to degrade
 * gracefully on any stray legacy value rather than yielding NaN — which would
 * collapse bars to the left edge and trigger the squished sequential fallback.
 */
function toMs(v: unknown): number | null {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  if (v instanceof Date) return v.getTime();
  const t = new Date(v as string).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * Derive the timeline's row model from the run's test cases. Returns the
 * drawable items, the ordered worker rows, the shard groupings, and the total
 * time span. Pure and free of DOM/viewport concerns so it can be unit-tested.
 */
export function useTimelineModel(props: TimelineModelInput): {
  timelineData: ComputedRef<TimelineItem[]>;
  workerRows: ComputedRef<Array<{ shardIndex: number | null; workerIndex: number }>>;
  shardGroups: ComputedRef<ShardGroup[]>;
  maxTime: ComputedRef<number>;
} {
  /** Effective wasted-wait patterns (falls back to the built-in default). */
  const wastedPatterns = computed<readonly string[]>(() =>
    props.wastedPatterns && props.wastedPatterns.length > 0 ? props.wastedPatterns : DEFAULT_WASTED_WAIT_PATTERNS,
  );

  const timelineData = computed<TimelineItem[]>(() => {
    const byWorker = new Map<WorkerKey, TestCaseResult[]>();

    for (const tc of props.testCases) {
      const key = workerKey(tc);
      if (!key) continue;
      if (!byWorker.has(key)) byWorker.set(key, []);
      byWorker.get(key)!.push(tc);
    }

    // Sort workers: first by shardIndex (null last), then by workerIndex
    const sortedWorkers = [...byWorker.entries()].sort(([a], [b]) => {
      const [aShard, aWorker] = a.split('|');
      const [bShard, bWorker] = b.split('|');
      const aS = aShard === 'null' ? Infinity : Number(aShard);
      const bS = bShard === 'null' ? Infinity : Number(bShard);
      if (aS !== bS) return aS - bS;
      return Number(aWorker) - Number(bWorker);
    });

    let minStartedAt = Infinity;
    let hasStartedAt = false;
    for (const [, cases] of sortedWorkers) {
      for (const tc of cases) {
        const sa = toMs(tc.startedAt);
        if (sa != null && sa > 0) {
          minStartedAt = Math.min(minStartedAt, sa);
          hasStartedAt = true;
        }
      }
    }

    const result: TimelineItem[] = [];
    // Per-worker end cursor, used by the sequential fallback to append setup
    // steps after each worker's test cases.
    const rowEndByWorker = new Map<number, number>();
    if (hasStartedAt) {
      for (let ri = 0; ri < sortedWorkers.length; ri++) {
        const [key, cases] = sortedWorkers[ri]!;
        const shardIdx = key.split('|')[0];
        const shardIndex = shardIdx === 'null' ? null : Number(shardIdx);

        // (shard group boundaries are derived from workerRows below)

        // Collect all discrete items (tests + their hook steps) for this worker
        const workerItems: TimelineItem[] = [];

        for (const tc of cases) {
          const dur = tc.duration ?? 1000;
          workerItems.push({
            id: tc.id,
            title: tc.title,
            status: tc.status,
            workerIndex: tc.workerIndex ?? 0,
            shardIndex,
            start: Math.max(0, (toMs(tc.startedAt) ?? minStartedAt) - minStartedAt),
            duration: dur,
            rowIndex: ri,
            isHook: false,
            isWait: false,
          });

          // Add hook/fixture segments for this test
          const steps = tc.stepEvents as TestStepEvent[] | null | undefined;
          if (steps && steps.length > 0) {
            for (const step of steps) {
              const isWaitStep = step.category === 'wait';
              // Non-wasted waits are framework noise already covered by the test
              // bar — only render waits the configured allowlist flags as wasted.
              if (isWaitStep && !isWastedWait(step, wastedPatterns.value)) continue;
              const stepStart = Math.max(0, (toMs(step.startedAt) ?? minStartedAt) - minStartedAt);
              workerItems.push({
                id: -tc.id - steps.indexOf(step) - 1,
                title: step.title,
                status: step.status || 'passed',
                workerIndex: tc.workerIndex ?? 0,
                shardIndex,
                start: stepStart,
                duration: step.duration || 0,
                rowIndex: ri,
                isHook: !isWaitStep,
                isWait: isWaitStep,
                category: step.category,
                parentTitle: tc.title,
              });
            }
          }
        }

        workerItems.sort((a, b) => a.start - b.start);
        result.push(...workerItems);
      }

      // Add suite-level setup steps (beforeAll/afterAll). Setup steps carry only a
      // `workerIndex` (no `shardIndex`), so place them on the first shard's worker
      // row for that index. `sortedWorkers` is ordered by shardIndex then
      // workerIndex, so the first match is shard 0 (or the null shard).
      const setupRowIndexByWorker = new Map<number, number>();
      for (let ri = 0; ri < sortedWorkers.length; ri++) {
        const wIdx = Number(sortedWorkers[ri]![0].split('|')[1]);
        if (!setupRowIndexByWorker.has(wIdx)) setupRowIndexByWorker.set(wIdx, ri);
      }

      if (props.setupSteps && props.setupSteps.length > 0) {
        for (const step of props.setupSteps) {
          const workerIdx = (step as any).workerIndex;
          if (workerIdx == null || workerIdx < 0) continue;
          const ri = setupRowIndexByWorker.get(workerIdx);
          if (ri == null) continue;

          const stepStart = Math.max(0, (toMs(step.startedAt) ?? minStartedAt) - minStartedAt);
          result.push({
            id: -999 - result.length,
            title: `[Setup] ${step.title}`,
            status: step.status || 'passed',
            workerIndex: workerIdx,
            shardIndex: null,
            start: stepStart,
            duration: step.duration || 0,
            rowIndex: ri,
            isHook: true,
            isWait: false,
            isSetup: true,
            category: step.category,
            parentTitle: null,
          });
        }
      }
    } else {
      const setupRowIndexByWorkerFallback = new Map<number, number>();
      for (let ri = 0; ri < sortedWorkers.length; ri++) {
        const [key, rawCases] = sortedWorkers[ri]!;
        const wIdx = Number(key.split('|')[1]);
        if (!setupRowIndexByWorkerFallback.has(wIdx)) setupRowIndexByWorkerFallback.set(wIdx, ri);
        const shardIdx = key.split('|')[0];
        const shardIndex = shardIdx === 'null' ? null : Number(shardIdx);
        const sortedCases = [...rawCases].sort((a, b) => (toMs(a.startedAt) ?? 0) - (toMs(b.startedAt) ?? 0));
        let cursor = 0;
        for (const tc of sortedCases) {
          const dur = tc.duration ?? 1000;
          result.push({
            id: tc.id,
            title: tc.title,
            status: tc.status,
            workerIndex: tc.workerIndex ?? 0,
            shardIndex,
            start: cursor,
            duration: dur,
            rowIndex: ri,
            isHook: false,
            isWait: false,
          });
          cursor += dur;

          const steps = tc.stepEvents as TestStepEvent[] | null | undefined;
          if (steps && steps.length > 0) {
            for (const step of steps) {
              const isWaitStep = step.category === 'wait';
              if (isWaitStep && !isWastedWait(step, wastedPatterns.value)) continue;
              result.push({
                id: -tc.id - steps.indexOf(step) - 1,
                title: step.title,
                status: step.status || 'passed',
                workerIndex: tc.workerIndex ?? 0,
                shardIndex,
                start: cursor,
                duration: step.duration || 0,
                rowIndex: ri,
                isHook: !isWaitStep,
                isWait: isWaitStep,
                category: step.category,
                parentTitle: tc.title,
              });
              cursor += step.duration || 0;
            }
          }
        }
        // Remember this worker row's end cursor for appending setup steps.
        rowEndByWorker.set(wIdx, cursor);
      }

      // Add suite-level setup steps in the sequential fallback too (appended
      // after each worker's test cases, since without startedAt we can't
      // interleave them accurately).
      if (props.setupSteps && props.setupSteps.length > 0) {
        for (const step of props.setupSteps) {
          const workerIdx = (step as any).workerIndex;
          if (workerIdx == null || workerIdx < 0) continue;
          const ri = setupRowIndexByWorkerFallback.get(workerIdx);
          if (ri == null) continue;
          const start = rowEndByWorker.get(workerIdx) ?? 0;
          rowEndByWorker.set(workerIdx, start + (step.duration || 0));
          result.push({
            id: -999 - result.length,
            title: `[Setup] ${step.title}`,
            status: step.status || 'passed',
            workerIndex: workerIdx,
            shardIndex: null,
            start,
            duration: step.duration || 0,
            rowIndex: ri,
            isHook: true,
            isWait: false,
            isSetup: true,
            category: step.category,
            parentTitle: null,
          });
        }
      }
    }

    return result;
  });

  /** Ordered list of (shardIndex, workerIndex) pairs for row rendering */
  const workerRows = computed(() => {
    const seen = new Set<string>();
    const rows: Array<{ shardIndex: number | null; workerIndex: number }> = [];
    for (const item of timelineData.value) {
      const key = `${item.shardIndex ?? 'null'}|${item.workerIndex}`;
      if (!seen.has(key)) {
        seen.add(key);
        rows.push({ shardIndex: item.shardIndex, workerIndex: item.workerIndex });
      }
    }
    return rows;
  });

  /** Shard group boundaries derived from workerRows */
  const shardGroups = computed<ShardGroup[]>(() => {
    const groups: ShardGroup[] = [];
    for (let ri = 0; ri < workerRows.value.length; ri++) {
      const row = workerRows.value[ri]!;
      const prev = groups[groups.length - 1];
      if (!prev || prev.shardIndex !== row.shardIndex) {
        groups.push({ shardIndex: row.shardIndex, rowRange: [ri, ri] });
      } else {
        prev.rowRange[1] = ri;
      }
    }
    return groups;
  });

  const maxTime = computed(() => {
    let max = 0;
    for (const item of timelineData.value) {
      max = Math.max(max, item.start + item.duration);
    }
    return max || 60000;
  });

  return { timelineData, workerRows, shardGroups, maxTime };
}
