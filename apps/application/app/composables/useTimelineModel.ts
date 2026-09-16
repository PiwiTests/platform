import { computed, type ComputedRef } from 'vue';
import type { TestCaseResult, TestStepEvent, SetupStepEvent, PerformanceStep } from '~~/types/api';
import { isWastedWait, DEFAULT_WASTED_WAIT_PATTERNS } from '#shared/utils/wasted-waits';
import { buildStepSpans } from '~/utils/step-spans';

/** What a timeline bar represents; drives rendering, filtering and header counts. */
export type TimelineItemKind = 'test' | 'setup' | 'hook' | 'fixture' | 'wait' | 'step';

/** A single drawable element on the timeline: a test bar, hook/fixture segment, suite setup step, wasted wait, or an expanded step span. */
export interface TimelineItem {
  /** Unique, stable identity — the v-for key and the hover-dimming comparand. */
  key: string;
  kind: TimelineItemKind;
  /** DB id of the owning test case (click-through target); null for suite-level setup steps. */
  testCaseId: number | null;
  title: string;
  status: string;
  workerIndex: number;
  start: number;
  duration: number;
  rowIndex: number;
  /** Title of the test the segment belongs to (hooks/fixtures/waits/steps only). */
  parentTitle?: string | null;
  /** Lock names this execution held — test bars only (best effort). */
  locks?: string[] | null;
  /** Reporter step category (`action`, `assertion`, `hook`, …) — step items only. */
  category?: string;
  /** Nesting depth within the expanded test (1 = top level) — step items only. */
  depth?: number;
  /** The step's target (rendered locator or URL) — step items only. */
  subtitle?: string | null;
  /** Curated per-step params — step items only. */
  params?: Record<string, string | number | boolean> | null;
  /** Error message when the step failed — step items only. */
  error?: string | null;
  /** Whether this test row is currently expanded — test items only. */
  expanded?: boolean;
}

/** One worker lane: its identity, plus the flat lane band it occupies (base lane + span, in row units). */
export interface WorkerRow {
  shardIndex: number | null;
  workerIndex: number;
  /** Flat index of this worker's test lane. */
  baseLane: number;
  /** Number of lanes this worker occupies: 1 (the test lane) plus one per expanded step depth. */
  laneSpan: number;
}

/** Per-lock summary for the Locks table under the timeline. */
export interface LockSummary {
  lock: string;
  /** Distinct executions in the run that held this lock. */
  testCount: number;
  /** Total wall time the lock was held (union of holder intervals). */
  heldMs: number;
  /** Held time as a fraction of the run's wall time (0..1). */
  share: number;
  /**
   * Estimated time that ran serialized behind another holder: the duration of
   * each holder that started within 500 ms of the previous holder's end. A
   * heuristic — holders on separate shards do not actually coordinate.
   */
  serializationMs: number;
  /** True when the lock was held for most of the final quarter of the run. */
  dominatesTail: boolean;
}

/** Back-to-back gap under which a holder is treated as having waited for the lock. */
const LOCK_SERIALIZATION_GAP_MS = 500;

/** Merge sorted [start, end] intervals, joining overlapping or touching ones. */
function mergeIntervals(intervals: Array<{ start: number; end: number }>): Array<{ start: number; end: number }> {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: Array<{ start: number; end: number }> = [{ ...sorted[0]! }];
  for (let i = 1; i < sorted.length; i++) {
    const cur = sorted[i]!;
    const last = merged[merged.length - 1]!;
    if (cur.start <= last.end) last.end = Math.max(last.end, cur.end);
    else merged.push({ ...cur });
  }
  return merged;
}

/**
 * Summarize how each lock shaped the run, from the drawn test bars. Pure so it
 * can be unit-tested: takes the timeline items and the run span, returns one row
 * per lock ordered by held time descending.
 */
export function computeLockSummary(items: TimelineItem[], maxTime: number): LockSummary[] {
  const holdersByLock = new Map<string, Array<{ start: number; end: number }>>();
  for (const item of items) {
    if (item.kind !== 'test' || !item.locks?.length) continue;
    const interval = { start: item.start, end: item.start + item.duration };
    for (const lock of item.locks) {
      const list = holdersByLock.get(lock);
      if (list) list.push(interval);
      else holdersByLock.set(lock, [interval]);
    }
  }

  const tailStart = maxTime * 0.75;
  const tailLength = maxTime - tailStart;

  const rows: LockSummary[] = [];
  for (const [lock, holders] of holdersByLock) {
    const merged = mergeIntervals(holders);
    const heldMs = merged.reduce((sum, iv) => sum + (iv.end - iv.start), 0);

    const ordered = [...holders].sort((a, b) => a.start - b.start);
    let serializationMs = 0;
    for (let i = 1; i < ordered.length; i++) {
      const gap = ordered[i]!.start - ordered[i - 1]!.end;
      if (gap >= 0 && gap <= LOCK_SERIALIZATION_GAP_MS) {
        serializationMs += ordered[i]!.end - ordered[i]!.start;
      }
    }

    const heldInTail = merged.reduce(
      (sum, iv) => sum + Math.max(0, Math.min(iv.end, maxTime) - Math.max(iv.start, tailStart)),
      0,
    );
    const dominatesTail = tailLength > 0 && heldInTail / tailLength > 0.5;

    rows.push({
      lock,
      testCount: holders.length,
      heldMs,
      share: maxTime > 0 ? heldMs / maxTime : 0,
      serializationMs,
      dominatesTail,
    });
  }

  return rows.sort((a, b) => b.heldMs - a.heldMs || a.lock.localeCompare(b.lock));
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
  setupSteps?: SetupStepEvent[] | null;
  /** Allowlist of glob patterns classifying which waits count as wasted time. */
  wastedPatterns?: string[] | null;
  /** Execution ids whose step waterfall is expanded (drawn as nested sub-lanes). */
  expandedExecutions?: Set<number> | null;
  /** Execution id → its loaded step list, for the expanded rows. */
  stepsByExecution?: Map<number, PerformanceStep[]> | null;
}

/** One worker lane: its identity plus the cases that ran on it. */
interface WorkerGroup {
  shardIndex: number | null;
  workerIndex: number;
  cases: TestCaseResult[];
}

/**
 * Group test cases into worker lanes keyed by (shardIndex, workerIndex) — two
 * shards may have overlapping worker indices (e.g. both Shard 1 and Shard 2
 * have a Worker 0). Cases without a usable worker index are skipped. Lanes are
 * ordered by shardIndex (shardless last), then workerIndex.
 */
function groupByWorker(testCases: TestCaseResult[]): WorkerGroup[] {
  const byKey = new Map<string, WorkerGroup>();
  for (const tc of testCases) {
    const workerIndex = tc.workerIndex;
    if (workerIndex == null || workerIndex < 0) continue;
    const shardIndex = tc.shardIndex ?? null;
    const key = `${shardIndex ?? 'null'}|${workerIndex}`;
    let group = byKey.get(key);
    if (!group) {
      group = { shardIndex, workerIndex, cases: [] };
      byKey.set(key, group);
    }
    group.cases.push(tc);
  }
  return [...byKey.values()].sort((a, b) => {
    const aShard = a.shardIndex ?? Infinity;
    const bShard = b.shardIndex ?? Infinity;
    if (aShard !== bShard) return aShard - bShard;
    return a.workerIndex - b.workerIndex;
  });
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
 * Map a step event to the timeline kind it renders as, or null when it should
 * not be drawn: non-wasted waits are framework noise already covered by the
 * test bar, and other categories (test.step/expect) are never rendered as
 * segments.
 */
function stepKind(step: TestStepEvent, patterns: readonly string[]): 'hook' | 'fixture' | 'wait' | null {
  if (step.category === 'wait') return isWastedWait(step, patterns) ? 'wait' : null;
  if (step.category === 'hook' || step.category === 'fixture') return step.category;
  return null;
}

/**
 * Derive the timeline's row model from the run's test cases. Returns the
 * drawable items, the ordered worker rows, the shard groupings, and the total
 * time span. Pure and free of DOM/viewport concerns so it can be unit-tested.
 */
export function useTimelineModel(props: TimelineModelInput): {
  timelineData: ComputedRef<TimelineItem[]>;
  workerRows: ComputedRef<WorkerRow[]>;
  laneCount: ComputedRef<number>;
  shardGroups: ComputedRef<ShardGroup[]>;
  maxTime: ComputedRef<number>;
  runLocks: ComputedRef<string[]>;
  lockSummary: ComputedRef<LockSummary[]>;
} {
  /** Effective wasted-wait patterns (falls back to the built-in default). */
  const wastedPatterns = computed<readonly string[]>(() =>
    props.wastedPatterns && props.wastedPatterns.length > 0 ? props.wastedPatterns : DEFAULT_WASTED_WAIT_PATTERNS,
  );

  const workerGroups = computed(() => groupByWorker(props.testCases));

  // The earliest startedAt in the run anchors absolute positioning; when no case
  // carries a usable timestamp we fall back to packing cases sequentially.
  const minStartedAt = computed(() => {
    let min = Infinity;
    for (const worker of workerGroups.value) {
      for (const tc of worker.cases) {
        const sa = toMs(tc.startedAt);
        if (sa != null && sa > 0) min = Math.min(min, sa);
      }
    }
    return min;
  });
  const hasStartedAt = computed(() => Number.isFinite(minStartedAt.value));

  // Nested step spans per expanded execution, positioned on the run's absolute
  // clock. Empty until a row is expanded and its steps have been fetched. Needs
  // the case's startedAt to place steps, so it is skipped in the timestamp-less
  // fallback mode (where a shared clock does not exist).
  const expandedSpans = computed(() => {
    const out = new Map<number, ReturnType<typeof buildStepSpans>>();
    const expanded = props.expandedExecutions;
    const stepsMap = props.stepsByExecution;
    if (!expanded || !stepsMap || expanded.size === 0 || !hasStartedAt.value) return out;
    for (const worker of workerGroups.value) {
      for (const tc of worker.cases) {
        if (!expanded.has(tc.executionId)) continue;
        const steps = stepsMap.get(tc.executionId);
        const startMs = toMs(tc.startedAt);
        if (!steps || startMs == null) continue;
        out.set(tc.executionId, buildStepSpans(steps, startMs));
      }
    }
    return out;
  });

  // Lay workers out as flat lanes: each worker takes its test lane plus one lane
  // per level of the deepest expanded step tree on it, so a worker's band grows
  // only while one of its tests is expanded.
  const workerLayout = computed<{ rows: WorkerRow[]; laneCount: number }>(() => {
    const spans = expandedSpans.value;
    const rows: WorkerRow[] = [];
    let lane = 0;
    for (const worker of workerGroups.value) {
      let maxDepth = 0;
      for (const tc of worker.cases) {
        const r = spans.get(tc.executionId);
        if (r) maxDepth = Math.max(maxDepth, r.maxDepth);
      }
      const laneSpan = 1 + maxDepth;
      rows.push({ shardIndex: worker.shardIndex, workerIndex: worker.workerIndex, baseLane: lane, laneSpan });
      lane += laneSpan;
    }
    return { rows, laneCount: lane };
  });

  const timelineData = computed<TimelineItem[]>(() => {
    const workers = workerGroups.value;
    const rows = workerLayout.value.rows;
    const patterns = wastedPatterns.value;
    const absolute = hasStartedAt.value;
    const origin = minStartedAt.value;
    const spans = expandedSpans.value;
    const expanded = props.expandedExecutions;
    const absoluteStart = (startedAt: unknown) => Math.max(0, (toMs(startedAt) ?? origin) - origin);

    const result: TimelineItem[] = [];
    // Per-worker end cursor; positions items in fallback mode and marks where
    // setup steps get appended.
    const rowEndByWorker = new Map<number, number>();

    workers.forEach((worker, i) => {
      const baseLane = rows[i]!.baseLane;
      const rowItems: TimelineItem[] = [];
      // Fallback mode packs cases in start order; absolute mode keeps the
      // incoming order and sorts the finished row by start instead.
      const cases = absolute
        ? worker.cases
        : [...worker.cases].sort((a, b) => (toMs(a.startedAt) ?? 0) - (toMs(b.startedAt) ?? 0));
      let cursor = 0;

      for (const tc of cases) {
        const duration = tc.duration ?? 1000;
        const start = absolute ? absoluteStart(tc.startedAt) : cursor;
        rowItems.push({
          key: `t${tc.executionId}`,
          kind: 'test',
          testCaseId: tc.executionId,
          title: tc.title,
          status: tc.status,
          workerIndex: worker.workerIndex,
          start,
          duration,
          rowIndex: baseLane,
          locks: tc.locks ?? null,
          expanded: expanded?.has(tc.executionId) ?? false,
        });
        cursor = start + duration;

        const stepEvents = (tc.stepEvents ?? []) as TestStepEvent[];
        stepEvents.forEach((step, stepIndex) => {
          const kind = stepKind(step, patterns);
          if (!kind) return;
          const stepDuration = step.duration || 0;
          const stepStart = absolute ? absoluteStart(step.startedAt) : cursor;
          rowItems.push({
            key: `s${tc.executionId}:${stepIndex}`,
            kind,
            testCaseId: tc.executionId,
            title: step.title,
            status: step.status || 'passed',
            workerIndex: worker.workerIndex,
            start: stepStart,
            duration: stepDuration,
            rowIndex: baseLane,
            parentTitle: tc.title,
          });
          cursor = stepStart + stepDuration;
        });

        // Expanded step waterfall: one nested sub-lane per depth, drawn only
        // across this test's own span.
        const stepResult = spans.get(tc.executionId);
        if (stepResult) {
          stepResult.spans.forEach((span, spanIndex) => {
            rowItems.push({
              key: `st${tc.executionId}:${spanIndex}`,
              kind: 'step',
              testCaseId: tc.executionId,
              title: span.title,
              status: span.status,
              workerIndex: worker.workerIndex,
              start: absoluteStart(span.startTime),
              duration: span.duration,
              rowIndex: baseLane + span.depth,
              parentTitle: tc.title,
              category: span.category,
              depth: span.depth,
              subtitle: span.subtitle ?? null,
              params: span.params ?? null,
              error: span.error ?? null,
            });
          });
        }
      }

      rowItems.sort((a, b) => a.start - b.start);
      result.push(...rowItems);
      // First shard wins, matching the setup-step row placement below.
      if (!rowEndByWorker.has(worker.workerIndex)) rowEndByWorker.set(worker.workerIndex, cursor);
    });

    // Suite-level setup steps (beforeAll/afterAll) carry only a workerIndex
    // (no shard), so place each on the first row with that worker index —
    // `workers` is ordered by shardIndex then workerIndex, so that's the first
    // shard (or the shardless lane). In absolute mode they sit at their own
    // startedAt; in fallback mode they're appended after the worker's cases,
    // since without timestamps we can't interleave them accurately.
    if (props.setupSteps && props.setupSteps.length > 0) {
      const baseLaneByWorker = new Map<number, number>();
      workers.forEach((worker, i) => {
        if (!baseLaneByWorker.has(worker.workerIndex)) baseLaneByWorker.set(worker.workerIndex, rows[i]!.baseLane);
      });

      props.setupSteps.forEach((step, setupIndex) => {
        const workerIndex = step.workerIndex;
        if (workerIndex == null || workerIndex < 0) return;
        const baseLane = baseLaneByWorker.get(workerIndex);
        if (baseLane == null) return;

        const duration = step.duration || 0;
        let start: number;
        if (absolute) {
          start = absoluteStart(step.startedAt);
        } else {
          start = rowEndByWorker.get(workerIndex) ?? 0;
          rowEndByWorker.set(workerIndex, start + duration);
        }

        result.push({
          key: `setup${workerIndex}:${setupIndex}`,
          kind: 'setup',
          testCaseId: null,
          title: `[Setup] ${step.title}`,
          status: step.status || 'passed',
          workerIndex,
          start,
          duration,
          rowIndex: baseLane,
          parentTitle: null,
        });
      });
    }

    return result;
  });

  /** Ordered worker lanes with their flat-lane bands; items render on the lane at `rowIndex`. */
  const workerRows = computed<WorkerRow[]>(() => workerLayout.value.rows);

  /** Total flat lanes, including expanded step sub-lanes — the timeline's row count. */
  const laneCount = computed(() => workerLayout.value.laneCount);

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

  /** Distinct lock names declared anywhere in the run, sorted for stable colors. */
  const runLocks = computed(() => {
    const locks = new Set<string>();
    for (const tc of props.testCases) for (const lock of tc.locks ?? []) locks.add(lock);
    return [...locks].sort((a, b) => a.localeCompare(b));
  });

  const lockSummary = computed(() => computeLockSummary(timelineData.value, maxTime.value));

  return { timelineData, workerRows, laneCount, shardGroups, maxTime, runLocks, lockSummary };
}
