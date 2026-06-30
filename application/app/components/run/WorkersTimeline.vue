<script setup lang="ts">
import { ref, computed } from 'vue';
import type { TestCaseResult, TestStepEvent } from '~~/types/api';
import { useTimelineModel, type TimelineItem } from '~/composables/useTimelineModel';
import { useTimelineViewport } from '~/composables/useTimelineViewport';

const props = defineProps<{
  testCases: TestCaseResult[];
  setupSteps?: TestStepEvent[] | null;
  shardTotal?: number | null;
  live?: boolean;
  /** Allowlist of glob patterns classifying which waits count as wasted time. */
  wastedPatterns?: string[] | null;
}>();

const emit = defineEmits<{
  selectTestCase: [id: number];
}>();

const { timelineData, workerRows, shardGroups, maxTime } = useTimelineModel(props);

const containerRef = ref<HTMLElement | null>(null);
const rowCount = computed(() => workerRows.value.length);
const hasData = computed(() => timelineData.value.length > 0);

const {
  panX,
  isPanning,
  pxPerMs,
  contentWidth,
  contentHeight,
  getBarX,
  getBarWidth,
  getBarTop,
  tickMarks,
  onWheel,
  onMouseDown,
  onMouseMove,
  onMouseUp,
  resetView,
} = useTimelineViewport({ containerRef, maxTime, rowCount, hasData, live: () => props.live });

// Header counts (tests vs. hook/fixture segments vs. wasted waits).
const testCount = computed(() => timelineData.value.filter((d) => !d.isHook && !d.isWait).length);
const hookCount = computed(() => timelineData.value.filter((d) => d.isHook).length);
const waitCount = computed(() => timelineData.value.filter((d) => d.isWait).length);

// Span types the timeline can draw, toggled from the header dropdown. Only the
// kinds actually present in the run are offered.
type SpanKind = 'test' | 'setup' | 'hook' | 'fixture' | 'wait';
const SPAN_KIND_ORDER: SpanKind[] = ['test', 'setup', 'hook', 'fixture', 'wait'];
const SPAN_KIND_LABELS: Record<SpanKind, string> = {
  test: 'Tests',
  setup: 'Setup (beforeAll/afterAll)',
  hook: 'Hooks',
  fixture: 'Fixtures',
  wait: 'Wasted waits',
};

function spanKind(item: TimelineItem): SpanKind {
  if (item.isWait) return 'wait';
  if (item.isSetup) return 'setup';
  if (item.isHook) return item.category === 'fixture' ? 'fixture' : 'hook';
  return 'test';
}

// Stores only the kinds explicitly hidden; everything defaults to visible.
const hiddenKinds = ref<Partial<Record<SpanKind, boolean>>>({});
const visibleItems = computed(() => timelineData.value.filter((item) => !hiddenKinds.value[spanKind(item)]));

const spanTypeItems = computed(() => {
  const present = new Set(timelineData.value.map(spanKind));
  return SPAN_KIND_ORDER.filter((k) => present.has(k)).map((k) => ({
    key: k,
    label: SPAN_KIND_LABELS[k],
    checked: !hiddenKinds.value[k],
  }));
});

function toggleSpanKind(key: string, visible: boolean) {
  hiddenKinds.value = { ...hiddenKinds.value, [key]: !visible };
}

// Tooltip state — driven by hover events from the bars.
const hoveredItem = ref<TimelineItem | null>(null);
const tooltipPos = ref({ x: 0, y: 0 });

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
  <div v-if="timelineData.length > 0" class="relative select-none">
    <TimelineHeader
      :worker-count="workerRows.length"
      :shard-total="shardTotal"
      :test-count="testCount"
      :hook-count="hookCount"
      :wait-count="waitCount"
      :span-types="spanTypeItems"
      :live="live"
      @toggle-span="toggleSpanKind"
      @reset="resetView"
    />

    <div
      ref="containerRef"
      class="relative overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
      :class="{ 'cursor-grab': !isPanning, 'cursor-grabbing': isPanning }"
      :style="{ height: contentHeight + 'px' }"
      @wheel.prevent="onWheel"
      @mousedown="onMouseDown"
      @mousemove="onMouseMove"
      @mouseup="onMouseUp"
      @mouseleave="onMouseUp"
    >
      <svg
        class="overflow-visible"
        :style="{ transform: `translateX(${panX}px)` }"
        :width="contentWidth"
        :height="contentHeight"
      >
        <defs>
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
          :shard-groups="shardGroups"
          :tick-marks="tickMarks"
          :content-width="contentWidth"
          :shard-total="shardTotal"
        />

        <TimelineBar
          v-for="item in visibleItems"
          :key="item.id"
          :item="item"
          :x="getBarX(item)"
          :y="getBarTop(item)"
          :width="getBarWidth(item)"
          :px-per-ms="pxPerMs"
          :dimmed="!!hoveredItem && hoveredItem.id !== item.id"
          @select="emit('selectTestCase', $event)"
          @hover="onBarEnter"
          @move="onBarMove"
          @leave="onBarLeave"
        />
      </svg>
    </div>

    <TimelineTooltip :item="hoveredItem" :pos="tooltipPos" />
  </div>
  <div v-else class="text-center py-10 text-gray-500">
    <UIcon name="i-lucide-rows-3" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
    <p>No worker data available for this run.</p>
  </div>
</template>
