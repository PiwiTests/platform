<script setup lang="ts">
import { onMounted, onUnmounted, nextTick, watchEffect } from 'vue';
import type { TestCaseResult, TestStepEvent } from '~~/types/api';

interface TimelineItem {
  id: number;
  title: string;
  status: string;
  workerIndex: number;
  shardIndex: number | null;
  start: number;
  duration: number;
  rowIndex: number;
  isHook: boolean;
  category?: string;
  parentTitle?: string | null;
}

/** Shard group for rendering separators and labels */
interface ShardGroup {
  shardIndex: number | null;
  /** Row indices (0-based) within this shard's worker rows */
  rowRange: [number, number];
}

const props = defineProps<{
  testCases: TestCaseResult[];
  setupSteps?: TestStepEvent[] | null;
  shardTotal?: number | null;
  live?: boolean;
}>();

const emit = defineEmits<{
  selectTestCase: [id: number];
}>();

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
      if (tc.startedAt != null && tc.startedAt > 0) {
        minStartedAt = Math.min(minStartedAt, tc.startedAt);
        hasStartedAt = true;
      }
    }
  }

  const result: TimelineItem[] = [];
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
          start: Math.max(0, (tc.startedAt ?? minStartedAt) - minStartedAt),
          duration: dur,
          rowIndex: ri,
          isHook: false,
        });

        // Add hook/fixture segments for this test
        const steps = tc.stepEvents as TestStepEvent[] | null | undefined;
        if (steps && steps.length > 0) {
          for (const step of steps) {
            const stepStart = Math.max(0, step.startedAt - minStartedAt);
            workerItems.push({
              id: -tc.id - steps.indexOf(step) - 1,
              title: step.title,
              status: step.status || 'passed',
              workerIndex: tc.workerIndex ?? 0,
              shardIndex,
              start: stepStart,
              duration: step.duration || 0,
              rowIndex: ri,
              isHook: true,
              category: step.category,
              parentTitle: tc.title,
            });
          }
        }
      }

      workerItems.sort((a, b) => a.start - b.start);
      result.push(...workerItems);
    }

    // Add suite-level setup steps (beforeAll/afterAll)
    if (props.setupSteps && props.setupSteps.length > 0) {
      for (const step of props.setupSteps) {
        const workerIdx = (step as any).workerIndex;
        if (workerIdx == null || workerIdx < 0) continue;
        const workerRow = sortedWorkers.findIndex(([,]) => {
          // Try matching by workerIndex suffix alone (setup steps have no shardIndex)
          return true;
        });
        const row = sortedWorkers.find(([key]) => key.endsWith(`|${workerIdx}`));
        if (!row) continue;
        const ri = sortedWorkers.indexOf(row);

        const stepStart = Math.max(0, step.startedAt - minStartedAt);
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
          category: step.category,
          parentTitle: null,
        });
      }
    }
  } else {
    for (let ri = 0; ri < sortedWorkers.length; ri++) {
      const [key, rawCases] = sortedWorkers[ri]!;
      const shardIdx = key.split('|')[0];
      const shardIndex = shardIdx === 'null' ? null : Number(shardIdx);
      const sortedCases = [...rawCases].sort((a, b) => (a.startedAt ?? 0) - (b.startedAt ?? 0));
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
        });
        cursor += dur;
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

function getStatusHex(status: string): string {
  const colors: Record<string, string> = {
    passed: '#16a34a',
    failed: '#dc2626',
    timedOut: '#ea580c',
    running: '#2563eb',
    initialising: '#2563eb',
    skipped: '#9ca3af',
    cancelled: '#a1a1aa',
    interrupted: '#ea580c',
    flaky: '#ca8a04',
  };
  return colors[status] || '#a1a1aa';
}

function getHookFill(item: TimelineItem): string {
  if (!item.isHook) return getStatusHex(item.status);
  const base = getStatusHex(item.status);
  return base + '66';
}

function getHookStroke(item: TimelineItem): string {
  if (!item.isHook) return 'none';
  return getStatusHex(item.status);
}

const zoom = ref(1);
const panX = ref(0);
const isPanning = ref(false);
const panStartX = ref(0);
const panStartOffsetX = ref(0);
const containerRef = ref<HTMLElement | null>(null);

function computeFitZoom(): number {
  const cw = containerRef.value?.clientWidth;
  if (!cw || maxTime.value <= 0) return 1;
  const minPxPerMs = (cw - labelWidth) / maxTime.value;
  return Math.min(1, minPxPerMs / 0.5);
}

function applyFitZoom() {
  const z = computeFitZoom();
  if (z > 0) {
    zoom.value = z;
    panX.value = 0;
  }
}

onMounted(() => {
  nextTick(applyFitZoom);
});

let resizeObserver: ResizeObserver | null = null;
onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      applyFitZoom();
    });
    resizeObserver.observe(containerRef.value);
  }
});

onUnmounted(() => {
  resizeObserver?.disconnect();
});

watchEffect(() => {
  if (props.live && timelineData.value.length > 0) {
    nextTick(applyFitZoom);
  }
});

const barHeight = 24;
const rowGap = 8;
const labelWidth = 80;
const sidePadding = 16;
const axisHeight = 28;
const rowHeight = barHeight + rowGap;

const pxPerMs = computed(() => 0.5 * zoom.value);

const contentWidth = computed(() => maxTime.value * pxPerMs.value + labelWidth + sidePadding);

const contentHeight = computed(() => workerRows.value.length * rowHeight + axisHeight);

function getBarX(item: TimelineItem) {
  return item.start * pxPerMs.value + labelWidth;
}

function getBarWidth(item: TimelineItem) {
  return Math.max(item.duration * pxPerMs.value, 3);
}

function getBarTop(item: TimelineItem) {
  return item.rowIndex * rowHeight + axisHeight;
}

function clampPanX(raw: number): number {
  if (!containerRef.value) return raw;
  const cw = containerRef.value.clientWidth;
  if (contentWidth.value <= cw) return 0;
  return Math.max(cw - contentWidth.value, Math.min(0, raw));
}

const tickMarks = computed<{ ms: number; x: number; label: string }[]>(() => {
  const ticks: { ms: number; x: number; label: string }[] = [];
  const step = zoom.value < 0.5 ? 10000 : zoom.value < 1 ? 5000 : zoom.value < 2 ? 2000 : 1000;
  for (let ms = 0; ms <= maxTime.value; ms += step) {
    ticks.push({
      ms,
      x: ms * pxPerMs.value + labelWidth,
      label: formatTime(ms),
    });
  }
  return ticks;
});

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`;
}

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

watchEffect(() => {
  if (props.live && timelineData.value.length > 0) {
    nextTick(applyFitZoom);
  }
});

function onWheel(event: WheelEvent) {
  if (props.live) return;
  event.preventDefault();
  const delta = event.deltaY > 0 ? -0.02 : 0.02;
  const fitZoom = computeFitZoom();
  const newZoom = Math.max(fitZoom, Math.min(10, zoom.value + delta));

  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect();
    const mouseX = event.clientX - rect.left;
    const scale = newZoom / zoom.value;
    panX.value = clampPanX(mouseX - (mouseX - panX.value) * scale);
  }

  zoom.value = newZoom;
}

function onMouseDown(event: MouseEvent) {
  if (props.live) return;
  if (event.button !== 0) return;
  isPanning.value = true;
  panStartX.value = event.clientX;
  panStartOffsetX.value = panX.value;
  event.preventDefault();
}

function onMouseMove(event: MouseEvent) {
  if (!isPanning.value) return;
  panX.value = clampPanX(panStartOffsetX.value + (event.clientX - panStartX.value));
}

function onMouseUp() {
  isPanning.value = false;
}

function resetView() {
  applyFitZoom();
}
</script>

<template>
  <div v-if="timelineData.length > 0" class="relative select-none">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-gray-500"
        >{{ workerRows.length }} worker{{ workerRows.length > 1 ? 's' : '' }}
        <template v-if="shardTotal && shardTotal > 1">
          &middot; {{ shardTotal }} shard{{ shardTotal > 1 ? 's' : '' }}
        </template>
        &middot; {{ timelineData.filter((d) => !d.isHook).length }} tests
        <template v-if="timelineData.some((d) => d.isHook)">
          &middot; {{ timelineData.filter((d) => d.isHook).length }} hooks
        </template>
      </span>
      <UButton v-if="!live" size="xs" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" @click="resetView">
        Reset view
      </UButton>
    </div>

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
        <rect
          v-for="(row, i) in workerRows"
          :key="'bg-' + i"
          :x="0"
          :y="i * rowHeight + axisHeight"
          :width="contentWidth"
          :height="rowHeight"
          :fill="i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.03)'"
          class="dark:fill-white/[0.03]"
        />

        <!-- Shard group separator lines -->
        <line
          v-for="sg in shardGroups.slice(1)"
          :key="'shard-sep-' + sg.rowRange[0]"
          :x1="0"
          :y1="sg.rowRange[0] * rowHeight + axisHeight - rowGap / 2"
          :x2="contentWidth"
          :y2="sg.rowRange[0] * rowHeight + axisHeight - rowGap / 2"
          stroke="currentColor"
          stroke-dasharray="4,3"
          class="stroke-gray-400 dark:stroke-gray-500"
        />

        <line
          :x1="labelWidth"
          :y1="axisHeight"
          :x2="contentWidth"
          :y2="axisHeight"
          stroke="currentColor"
          class="stroke-gray-300 dark:stroke-gray-600"
        />

        <g v-for="tick in tickMarks" :key="tick.ms">
          <line
            :x1="tick.x"
            :y1="axisHeight - 4"
            :x2="tick.x"
            :y2="axisHeight"
            stroke="currentColor"
            class="stroke-gray-300 dark:stroke-gray-600"
          />
          <text :x="tick.x" :y="axisHeight - 8" text-anchor="middle" class="fill-gray-400 text-[10px]">
            {{ tick.label }}
          </text>
        </g>

        <text
          v-for="(row, i) in workerRows"
          :key="'label-' + i"
          :x="6"
          :y="i * rowHeight + axisHeight + barHeight / 2 + 4"
          class="fill-gray-500 text-[11px] font-medium"
        >
          {{
            row.shardIndex != null && shardTotal && shardTotal > 1
              ? `S${row.shardIndex} W${row.workerIndex}`
              : `Worker ${row.workerIndex}`
          }}
        </text>

        <g
          v-for="item in timelineData"
          :key="item.id"
          @mouseenter="onBarEnter(item, $event)"
          @mousemove="onBarMove"
          @mouseleave="onBarLeave"
        >
          <template v-if="item.isHook">
            <rect
              :x="getBarX(item)"
              :y="getBarTop(item)"
              :width="getBarWidth(item)"
              :height="barHeight"
              :rx="3"
              :ry="3"
              :fill="getHookFill(item)"
              :stroke="getHookStroke(item)"
              stroke-width="1"
              stroke-dasharray="3,2"
              class="transition-opacity duration-100 cursor-default"
              :class="hoveredItem && hoveredItem.id !== item.id ? 'opacity-40' : 'opacity-80'"
            />
            <text
              v-if="getBarWidth(item) > 60"
              :x="getBarX(item) + 4"
              :y="getBarTop(item) + barHeight / 2 + 4"
              class="fill-gray-600 dark:fill-gray-300 text-[9px] font-medium pointer-events-none"
            >
              {{ item.title }}
            </text>
          </template>
          <template v-else-if="item.status === 'running'">
            <circle
              :cx="getBarX(item) + 300 * pxPerMs"
              :cy="getBarTop(item) + barHeight / 2"
              r="3"
              fill="#2563eb"
              filter="url(#glow)"
              class="cursor-pointer"
              :class="hoveredItem && hoveredItem.id !== item.id ? 'opacity-40' : 'opacity-90'"
              @click="emit('selectTestCase', item.id)"
            />
            <circle
              :cx="getBarX(item) + 300 * pxPerMs"
              :cy="getBarTop(item) + barHeight / 2"
              r="5"
              fill="none"
              stroke="#2563eb"
              stroke-width="1.5"
              stroke-opacity="0.4"
              filter="url(#glow)"
              class="cursor-pointer"
              :class="hoveredItem && hoveredItem.id !== item.id ? 'opacity-40' : 'opacity-90'"
              @click="emit('selectTestCase', item.id)"
            />
          </template>
          <template v-else>
            <rect
              :x="getBarX(item)"
              :y="getBarTop(item)"
              :width="getBarWidth(item)"
              :height="barHeight"
              :rx="3"
              :ry="3"
              :fill="getStatusHex(item.status)"
              class="transition-opacity duration-100 cursor-pointer"
              :class="hoveredItem && hoveredItem.id !== item.id ? 'opacity-40' : 'opacity-90'"
              @click="emit('selectTestCase', item.id)"
            />
            <text
              v-if="getBarWidth(item) > 40"
              :x="getBarX(item) + 4"
              :y="getBarTop(item) + barHeight / 2 + 4"
              class="fill-white text-[10px] font-medium pointer-events-none"
            >
              {{ formatTime(item.duration) }}
            </text>
          </template>
        </g>
      </svg>
    </div>

    <Teleport to="body">
      <div
        v-if="hoveredItem"
        class="fixed z-[9999] pointer-events-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs shadow-lg"
        :style="{ left: tooltipPos.x + 12 + 'px', top: tooltipPos.y - 10 + 'px' }"
      >
        <div class="flex items-center gap-2 mb-1">
          <span
            v-if="!hoveredItem.isHook"
            class="inline-block size-2.5 rounded-full shrink-0"
            :style="{ backgroundColor: getStatusHex(hoveredItem.status) }"
          />
          <span
            v-else
            class="inline-block size-2.5 rounded-full shrink-0 border border-dashed"
            :style="{
              backgroundColor: getHookFill(hoveredItem),
              borderColor: getHookStroke(hoveredItem),
            }"
          />
          <span class="font-medium text-gray-900 dark:text-white max-w-64 truncate">
            <template v-if="hoveredItem.isHook">
              <span class="uppercase text-[10px] tracking-wider text-gray-500 mr-1">{{ hoveredItem.category }}</span>
              {{ hoveredItem.title }}
            </template>
            <template v-else>
              {{ hoveredItem.title }}
            </template>
          </span>
        </div>
        <div class="flex items-center gap-3 text-gray-500">
          <span class="capitalize">{{ hoveredItem.status }}</span>
          <span>{{ formatTime(hoveredItem.duration) }}</span>
          <span>Worker {{ hoveredItem.workerIndex }}</span>
          <span v-if="hoveredItem.isHook && hoveredItem.parentTitle" class="italic truncate max-w-48">
            for {{ hoveredItem.parentTitle }}
          </span>
        </div>
      </div>
    </Teleport>
  </div>
  <div v-else class="text-center py-10 text-gray-500">
    <UIcon name="i-lucide-rows-3" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
    <p>No worker data available for this run.</p>
  </div>
</template>
