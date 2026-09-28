<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import type { TestCaseResult, SetupStepEvent, PerformanceStep } from '~~/types/api';
import { useTimelineModel, isHookKind, type TimelineItem } from '~/composables/useTimelineModel';
import { useTimelineViewport } from '~/composables/useTimelineViewport';
import { lockColorHex } from '~/utils/timeline';

const props = defineProps<{
  testCases: TestCaseResult[];
  setupSteps?: SetupStepEvent[] | null;
  shardTotal?: number | null;
  live?: boolean;
  /** Allowlist of glob patterns classifying which waits count as wasted time. */
  wastedPatterns?: string[] | null;
}>();

const emit = defineEmits<{
  selectTestCase: [id: number];
}>();

// Which test rows are expanded into their step waterfall, and the steps fetched
// for them (loaded on demand — the run payload omits the heavy `steps` column).
const expandedExecutions = ref(new Set<number>());
const stepsByExecution = ref(new Map<number, PerformanceStep[]>());
const stepsLoading = new Set<number>();

// Getter-based input so useTimelineModel keeps tracking the component props and
// the expansion refs reactively (a spread would snapshot them).
const modelInput = {
  get testCases() {
    return props.testCases;
  },
  get setupSteps() {
    return props.setupSteps;
  },
  get wastedPatterns() {
    return props.wastedPatterns;
  },
  get expandedExecutions() {
    return expandedExecutions.value;
  },
  get stepsByExecution() {
    return stepsByExecution.value;
  },
};

const { timelineData, workerRows, laneCount, maxTime, runLocks } = useTimelineModel(modelInput);

const expandedCount = computed(() => expandedExecutions.value.size);

/** A test row can be expanded when it is a persisted execution and the run is not live. */
function barExpandable(item: TimelineItem): boolean {
  return item.kind === 'test' && !props.live && (item.testCaseId ?? 0) > 0;
}

async function toggleExpand(id: number): Promise<void> {
  if (expandedExecutions.value.has(id)) {
    const next = new Set(expandedExecutions.value);
    next.delete(id);
    expandedExecutions.value = next;
    return;
  }
  // Frame the test's own span — at run-fit zoom its steps are sub-pixel.
  const testItem = timelineData.value.find((d) => d.kind === 'test' && d.testCaseId === id);
  await expandSteps(id, testItem ? [testItem.start, testItem.start + testItem.duration] : null);
}

/**
 * A click on a hook section opens its test's steps framed on the hook, so the
 * `beforeAll`, `afterEach` and fixtures it ran, and the one that failed, are
 * legible. A test that cannot expand (a live run) opens its page instead.
 */
async function inspectHook(item: TimelineItem): Promise<void> {
  const id = item.testCaseId;
  if (id == null) return;
  const testItem = timelineData.value.find((d) => d.kind === 'test' && d.testCaseId === id);
  if (!testItem || !barExpandable(testItem)) {
    emit('selectTestCase', id);
    return;
  }
  await expandSteps(id, [item.start, item.start + Math.max(item.duration, 1)]);
}

/** Expand a test row into its step waterfall (fetching the steps once), framing `range` when given. */
async function expandSteps(id: number, range: [number, number] | null): Promise<void> {
  if (!expandedExecutions.value.has(id)) {
    const next = new Set(expandedExecutions.value);
    next.add(id);
    expandedExecutions.value = next;
  }
  if (range) zoomToRange(range[0], range[1]);

  if (stepsByExecution.value.has(id) || stepsLoading.has(id)) return;
  stepsLoading.add(id);
  try {
    const res = await $fetch<{ steps: PerformanceStep[] }>(`/api/test-run-cases/${id}/steps`);
    const map = new Map(stepsByExecution.value);
    map.set(id, res.steps ?? []);
    stepsByExecution.value = map;
  } catch {
    // Leave the row expanded but empty; toggling it again retries the fetch.
  } finally {
    stepsLoading.delete(id);
  }
}

function collapseAll(): void {
  expandedExecutions.value = new Set();
}

// Lock name → its color (assigned by the run's sorted lock order, so a lock
// keeps its color across the brackets, the legend and the tooltip).
const lockColorMap = computed(() => {
  const map = new Map<string, string>();
  runLocks.value.forEach((lock, i) => map.set(lock, lockColorHex(i)));
  return map;
});
const hasLocks = computed(() => runLocks.value.length > 0);
const showLocks = ref(false);

/** The colors for one bar's locks, in the run's stable lock order. */
function lockColorsFor(item: TimelineItem): string[] {
  if (!showLocks.value || item.kind !== 'test' || !item.locks?.length) return [];
  return runLocks.value.filter((lock) => item.locks!.includes(lock)).map((lock) => lockColorMap.value.get(lock)!);
}

const containerRef = ref<HTMLElement | null>(null);
const rowCount = computed(() => laneCount.value);
const hasData = computed(() => timelineData.value.length > 0);

const {
  panX,
  isPanning,
  contentWidth,
  contentHeight,
  getBarX,
  getBarWidth,
  getBarTop,
  tickMarks,
  onWheel,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  resetView,
  zoomToRange,
} = useTimelineViewport({ containerRef, maxTime, rowCount, hasData, live: () => props.live });

// Header counts: tests, hook sections that failed, wasted waits.
const testCount = computed(() => timelineData.value.filter((d) => d.kind === 'test').length);
const hasHooks = computed(() => timelineData.value.some((d) => isHookKind(d.kind)));
const hookFailureCount = computed(
  () => timelineData.value.filter((d) => isHookKind(d.kind) && d.status === 'failed').length,
);
const waitCount = computed(() => timelineData.value.filter((d) => d.kind === 'wait').length);

// Tests and expanded step spans are always drawn (expanding a row is itself the
// request to see its steps). Hook sections are drawn by default and a failed
// one is drawn even with hooks off; wasted waits are drawn on request.
const showHooks = ref(true);
const showWaits = ref(false);
const visibleItems = computed(() =>
  timelineData.value.filter((item) => {
    if (isHookKind(item.kind)) return showHooks.value || item.status === 'failed';
    if (item.kind === 'wait') return showWaits.value;
    return true;
  }),
);

// Tooltip state — driven by hover events from the bars.
const hoveredItem = ref<TimelineItem | null>(null);
const tooltipPos = ref({ x: 0, y: 0 });

// Re-resolve the hovered item by key when the data changes: a removed bar
// fires no mouseleave (span-type toggled off, live update dropped it), which
// would otherwise strand the tooltip; a replaced bar carries fresh data the
// tooltip should reflect.
watch(visibleItems, (items) => {
  if (!hoveredItem.value) return;
  hoveredItem.value = items.find((item) => item.key === hoveredItem.value!.key) ?? null;
});

function onBarEnter(item: TimelineItem, event: MouseEvent) {
  hoveredItem.value = item;
  tooltipPos.value = { x: event.clientX, y: event.clientY };
}

function onBarMove(event: MouseEvent) {
  tooltipPos.value = { x: event.clientX, y: event.clientY };
}

function onBarLeave() {
  hoveredItem.value = null;
}
</script>

<template>
  <div v-if="timelineData.length > 0" class="relative select-none" data-shot="run-timeline">
    <TimelineHeader
      :worker-count="workerRows.length"
      :shard-total="shardTotal"
      :test-count="testCount"
      :hook-failure-count="hookFailureCount"
      :wait-count="waitCount"
      :has-hooks="hasHooks"
      :show-hooks="showHooks"
      :show-waits="showWaits"
      :has-locks="hasLocks"
      :show-locks="showLocks"
      :lock-count="runLocks.length"
      :expanded-count="expandedCount"
      :live="live"
      @toggle-hooks="showHooks = $event"
      @toggle-waits="showWaits = $event"
      @toggle-locks="showLocks = $event"
      @collapse-all="collapseAll"
      @reset="resetView"
    />

    <!-- Legend for the lock brackets, shown only while locks are on. -->
    <div v-if="showLocks && hasLocks" class="flex flex-wrap items-center gap-x-3 gap-y-1 mb-2 text-xs text-gray-500">
      <span class="inline-flex items-center gap-1">
        <UIcon name="i-lucide-lock" class="size-3" />
        Locks
      </span>
      <span v-for="lock in runLocks" :key="lock" class="inline-flex items-center gap-1">
        <span class="inline-block h-2 w-3 rounded-sm" :style="{ backgroundColor: lockColorMap.get(lock) }" />
        {{ lock }}
      </span>
    </div>

    <div
      ref="containerRef"
      class="relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700 touch-pan-y"
      :class="{ 'cursor-grab': !isPanning, 'cursor-grabbing': isPanning }"
      :style="{ height: contentHeight + 'px' }"
      @wheel.prevent="onWheel"
      @pointerdown="onPointerDown"
      @pointermove="onPointerMove"
      @pointerup="onPointerUp"
      @pointercancel="onPointerUp"
      @pointerleave="onPointerUp"
    >
      <svg
        class="overflow-visible"
        :style="{ transform: `translateX(${panX}px)` }"
        :width="contentWidth"
        :height="contentHeight"
      >
        <defs>
          <!-- Light diagonal stripes that mark hook time over a test bar. -->
          <pattern
            id="timeline-hook-hatch"
            patternUnits="userSpaceOnUse"
            width="6"
            height="6"
            patternTransform="rotate(45)"
          >
            <rect width="2" height="6" fill="white" fill-opacity="0.35" />
          </pattern>
          <filter id="glow">
            <feGaussianBlur stdDeviation="2.5" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>

        <TimelineGrid
          :worker-rows="workerRows"
          :tick-marks="tickMarks"
          :content-width="contentWidth"
          :shard-total="shardTotal"
        />

        <TimelineBar
          v-for="item in visibleItems"
          :key="item.key"
          :item="item"
          :x="getBarX(item)"
          :y="getBarTop(item)"
          :width="getBarWidth(item)"
          :lock-colors="lockColorsFor(item)"
          :expandable="barExpandable(item)"
          @select="emit('selectTestCase', $event)"
          @toggle-expand="toggleExpand($event)"
          @inspect-hook="inspectHook"
          @hover="onBarEnter"
          @move="onBarMove"
          @leave="onBarLeave"
        />
      </svg>
    </div>

    <TimelineTooltip :item="hoveredItem" :pos="tooltipPos" :lock-color-map="lockColorMap" />
  </div>
  <EmptyState v-else icon="i-lucide-rows-3" text="No worker data available for this run." />
</template>

<style>
/*
 * Hover-dimming for timeline bars is plain CSS rather than a Vue-bound
 * `dimmed` prop: with hundreds of bars, driving it through reactive props
 * made every bar re-render on each hover change. `:has()` lets the browser
 * do it in one style recalc with no Vue/JS involved.
 */
svg:has(.timeline-bar-group:hover) .timeline-bar-group:not(:hover) .timeline-bar-shape {
  opacity: 0.4;
}
</style>
