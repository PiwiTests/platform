<script setup lang="ts">
import { onMounted, onUnmounted, nextTick } from 'vue'
import type { TestCaseResult } from '~~/types/api'

interface TimelineItem {
  id: number
  title: string
  status: string
  workerIndex: number
  start: number
  duration: number
  rowIndex: number
}

const props = defineProps<{
  testCases: TestCaseResult[]
}>()

const emit = defineEmits<{
  selectTestCase: [id: number]
}>()

const timelineData = computed<TimelineItem[]>(() => {
  const byWorker = new Map<number, TestCaseResult[]>()

  for (const tc of props.testCases) {
    const w = tc.workerIndex
    if (w == null || w < 0) continue
    if (!byWorker.has(w)) byWorker.set(w, [])
    byWorker.get(w)!.push(tc)
  }

  const sortedWorkers = [...byWorker.entries()].sort(([a], [b]) => a - b)

  const result: TimelineItem[] = []
  for (let ri = 0; ri < sortedWorkers.length; ri++) {
    const [, cases] = sortedWorkers[ri]!
    let cursor = 0
    for (const tc of cases) {
      const dur = tc.duration ?? 1000
      result.push({
        id: tc.id,
        title: tc.title,
        status: tc.status,
        workerIndex: tc.workerIndex ?? 0,
        start: cursor,
        duration: dur,
        rowIndex: ri,
      })
      cursor += dur
    }
  }

  return result
})

const workers = computed(() => {
  return [...new Set(timelineData.value.map(d => d.workerIndex))].sort((a, b) => a - b)
})

const maxTime = computed(() => {
  let max = 0
  for (const item of timelineData.value) {
    max = Math.max(max, item.start + item.duration)
  }
  return max || 60000
})

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
  }
  return colors[status] || '#a1a1aa'
}

// Zoom & pan (lateral only)
const zoom = ref(1)
const panX = ref(0)
const isPanning = ref(false)
const panStartX = ref(0)
const panStartOffsetX = ref(0)
const containerRef = ref<HTMLElement | null>(null)

function computeFitZoom(): number {
  const cw = containerRef.value?.clientWidth
  if (!cw || maxTime.value <= 0) return 1
  const minPxPerMs = (cw - labelWidth) / maxTime.value
  return Math.min(1, minPxPerMs / 0.5)
}

function applyFitZoom() {
  const z = computeFitZoom()
  if (z > 0) {
    zoom.value = z
    panX.value = 0
  }
}

onMounted(() => {
  nextTick(applyFitZoom)
})

// Re-apply fit zoom on container resize
let resizeObserver: ResizeObserver | null = null
onMounted(() => {
  if (containerRef.value) {
    resizeObserver = new ResizeObserver(() => {
      applyFitZoom()
    })
    resizeObserver.observe(containerRef.value)
  }
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

const barHeight = 24
const rowGap = 8
const labelWidth = 80
const axisHeight = 28
const rowHeight = barHeight + rowGap

const pxPerMs = computed(() => 0.5 * zoom.value)

const contentWidth = computed(() => maxTime.value * pxPerMs.value + labelWidth)

const contentHeight = computed(() => workers.value.length * rowHeight + axisHeight)

function getBarX(item: TimelineItem) {
  return item.start * pxPerMs.value + labelWidth
}

function getBarWidth(item: TimelineItem) {
  return Math.max(item.duration * pxPerMs.value, 3)
}

function getBarTop(item: TimelineItem) {
  return item.rowIndex * rowHeight + axisHeight
}

function clampPanX(raw: number): number {
  if (!containerRef.value) return raw
  const cw = containerRef.value.clientWidth
  if (contentWidth.value <= cw) return 0
  return Math.max(cw - contentWidth.value, Math.min(0, raw))
}

// Tick marks for time axis
const tickMarks = computed<{ ms: number, x: number, label: string }[]>(() => {
  const ticks: { ms: number, x: number, label: string }[] = []
  const step = zoom.value < 0.5 ? 10000 : zoom.value < 1 ? 5000 : zoom.value < 2 ? 2000 : 1000
  for (let ms = 0; ms <= maxTime.value; ms += step) {
    ticks.push({
      ms,
      x: ms * pxPerMs.value + labelWidth,
      label: formatTime(ms),
    })
  }
  return ticks
})

function formatTime(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  return `${Math.floor(ms / 60000)}m ${Math.floor((ms % 60000) / 1000)}s`
}

// Tooltip
const hoveredItem = ref<TimelineItem | null>(null)
const tooltipPos = ref({ x: 0, y: 0 })

function onBarEnter(item: TimelineItem, event: MouseEvent) {
  hoveredItem.value = item
  tooltipPos.value = { x: event.clientX, y: event.clientY }
}

function onBarMove(event: MouseEvent) {
  tooltipPos.value = { x: event.clientX, y: event.clientY }
}

function onBarLeave() {
  hoveredItem.value = null
}

// Wheel zoom (lateral only)
function onWheel(event: WheelEvent) {
  event.preventDefault()
  const delta = event.deltaY > 0 ? -0.15 : 0.15
  const fitZoom = computeFitZoom()
  const newZoom = Math.max(fitZoom, Math.min(10, zoom.value + delta))

  if (containerRef.value) {
    const rect = containerRef.value.getBoundingClientRect()
    const mouseX = event.clientX - rect.left
    const scale = newZoom / zoom.value
    panX.value = clampPanX(mouseX - (mouseX - panX.value) * scale)
  }

  zoom.value = newZoom
}

// Drag pan (lateral only)
function onMouseDown(event: MouseEvent) {
  if (event.button !== 0) return
  isPanning.value = true
  panStartX.value = event.clientX
  panStartOffsetX.value = panX.value
  event.preventDefault()
}

function onMouseMove(event: MouseEvent) {
  if (!isPanning.value) return
  panX.value = clampPanX(panStartOffsetX.value + (event.clientX - panStartX.value))
}

function onMouseUp() {
  isPanning.value = false
}

function resetView() {
  applyFitZoom()
}
</script>

<template>
  <div class="relative select-none">
    <div class="flex items-center justify-between mb-2">
      <span class="text-xs text-gray-500">{{ workers.length }} worker{{ workers.length > 1 ? 's' : '' }} &middot; {{ timelineData.length }} tests</span>
      <UButton
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-rotate-ccw"
        @click="resetView"
      >
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
        <!-- Alternating row backgrounds -->
        <rect
          v-for="(w, i) in workers"
          :key="'bg-' + w"
          :x="0"
          :y="i * rowHeight + axisHeight"
          :width="contentWidth"
          :height="rowHeight"
          :fill="i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.03)'"
          class="dark:fill-white/[0.03]"
        />

        <!-- Time axis -->
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
          <text
            :x="tick.x"
            :y="axisHeight - 8"
            text-anchor="middle"
            class="fill-gray-400 text-[10px]"
          >
            {{ tick.label }}
          </text>
        </g>

        <!-- Worker labels -->
        <text
          v-for="(w, i) in workers"
          :key="'label-' + w"
          :x="6"
          :y="i * rowHeight + axisHeight + barHeight / 2 + 4"
          class="fill-gray-500 text-[11px] font-medium"
        >
          Worker {{ w }}
        </text>

        <!-- Bars -->
        <g
          v-for="item in timelineData"
          :key="item.id"
          @mouseenter="onBarEnter(item, $event)"
          @mousemove="onBarMove"
          @mouseleave="onBarLeave"
        >
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
        </g>
      </svg>
    </div>

    <!-- Tooltip -->
    <Teleport to="body">
      <div
        v-if="hoveredItem"
        class="fixed z-[9999] pointer-events-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs shadow-lg"
        :style="{ left: tooltipPos.x + 12 + 'px', top: tooltipPos.y - 10 + 'px' }"
      >
        <div class="flex items-center gap-2 mb-1">
          <span
            class="inline-block size-2.5 rounded-full shrink-0"
            :style="{ backgroundColor: getStatusHex(hoveredItem.status) }"
          />
          <span class="font-medium text-gray-900 dark:text-white max-w-64 truncate">{{ hoveredItem.title }}</span>
        </div>
        <div class="flex items-center gap-3 text-gray-500">
          <span class="capitalize">{{ hoveredItem.status }}</span>
          <span>{{ formatTime(hoveredItem.duration) }}</span>
          <span>Worker {{ hoveredItem.workerIndex }}</span>
        </div>
      </div>
    </Teleport>
  </div>
</template>
