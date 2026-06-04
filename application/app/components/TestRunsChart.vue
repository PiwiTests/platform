<script setup lang="ts">
import { VisXYContainer, VisArea, VisAxis, VisLine } from '@unovis/vue'
import { CurveType } from '@unovis/ts'
import type { TestRunForChart } from '~~/types/api'

interface Props {
  testRuns: TestRunForChart[]
  height?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 300
})

const chartData = computed(() => {
  if (!props.testRuns || props.testRuns.length === 0) {
    return []
  }

  const sortedRuns = [...props.testRuns]
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(-30)

  return sortedRuns.map(run => ({
    id: run.id,
    date: new Date(run.startTime),
    passed: run.passedTests || 0,
    failed: run.failedTests || 0,
    skipped: run.skippedTests || 0,
    flaky: run.flakyTests || 0,
    total: run.totalTests || 0,
    status: run.status,
  }))
})

type DataPoint = {
  id: number
  date: Date
  passed: number
  failed: number
  skipped: number
  flaky: number
  total: number
  status: string
}

const x = (d: DataPoint) => d.date

const yPassed = (d: DataPoint) => d.passed
const yFailed = (d: DataPoint) => d.failed
const ySkipped = (d: DataPoint) => d.skipped
const yFlaky = (d: DataPoint) => d.flaky

const areaColors = ['rgb(34, 197, 94)', 'rgb(239, 68, 68)', 'rgb(245, 158, 11)', 'rgb(147, 51, 234)'] as const

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const xyContainerRef = ref<any>(null)
const tooltipData = ref<DataPoint | null>(null)
const tooltipPos = ref({ x: 0, y: 0 })

const yAccessors: { fn: (d: DataPoint) => number, color: string }[] = [
  { fn: (d: DataPoint) => d.passed, color: areaColors[0] },
  { fn: (d: DataPoint) => d.failed, color: areaColors[1] },
  { fn: (d: DataPoint) => d.skipped, color: areaColors[2] },
  { fn: (d: DataPoint) => d.flaky, color: areaColors[3] },
]

const NS = 'http://www.w3.org/2000/svg'

function addMarkers(
  svgNode: SVGSVGElement,
  margin: { top: number, bottom: number, left: number, right: number }
) {
  svgNode.querySelectorAll('.chart-marker').forEach(el => el.remove())

  const container = xyContainerRef.value?.component
  if (!container || !chartData.value.length) {
    return
  }

  // xScale / yScale live on child components (VisArea, VisLine), not the XYContainer
  const comp = container.components?.[0]
  const xScale = comp?.xScale
  const yScale = comp?.yScale
  if (!xScale || !yScale) {
    return
  }

  const group = document.createElementNS(NS, 'g')
  group.setAttribute('class', 'chart-marker')
  group.setAttribute('transform', `translate(${margin.left},${margin.top})`)
  svgNode.appendChild(group)

  for (const point of chartData.value) {
    for (const { fn, color } of yAccessors) {
      const yVal = fn(point)
      const cx = xScale(point.date)
      const cy = yScale(yVal)
      const circle = document.createElementNS(NS, 'circle')
      circle.setAttribute('cx', String(cx))
      circle.setAttribute('cy', String(cy))
      circle.setAttribute('r', '4.5')
      circle.setAttribute('fill', color)
      circle.setAttribute('stroke', '#fff')
      circle.setAttribute('stroke-width', '1.5')
      circle.setAttribute('cursor', 'pointer')
      circle.addEventListener('click', () => navigateTo(`/test-runs/${point.id}`))
      circle.addEventListener('mouseenter', () => {
        circle.setAttribute('r', '7')
        circle.setAttribute('stroke-width', '2.5')
        tooltipData.value = point
      })
      circle.addEventListener('mousemove', (e: MouseEvent) => {
        const tw = 260
        const ox = 12
        const x = e.clientX + ox + tw > window.innerWidth - 8 ? e.clientX - tw - ox : e.clientX + ox
        tooltipPos.value = { x, y: e.clientY - 12 }
      })
      circle.addEventListener('mouseleave', () => {
        circle.setAttribute('r', '4.5')
        circle.setAttribute('stroke-width', '1.5')
        tooltipData.value = null
      })
      group.appendChild(circle)
    }
  }
}

function onChartRender(
  svgNode: SVGSVGElement,
  margin: { top: number, bottom: number, left: number, right: number }
) {
  addMarkers(svgNode, margin)
}
</script>

<template>
  <div class="w-full relative">
    <div v-if="chartData.length > 0">
      <VisXYContainer
        ref="xyContainerRef"
        :data="chartData"
        :height="height"
        :padding="{ top: 10, right: 10, bottom: 0, left: 0 }"
        :on-render-complete="onChartRender"
      >
        <VisArea
          :x="x"
          :y="[yPassed, yFailed, ySkipped, yFlaky]"
          :color="areaColors"
          :curve-type="CurveType.MonotoneX"
        />

        <VisLine
          :x="x"
          :y="[yPassed, yFailed, ySkipped, yFlaky]"
          :color="areaColors"
          :curve-type="CurveType.MonotoneX"
          :line-width="2"
        />

        <VisAxis
          type="x"
          :tick-format="(d: Date) => (new Date(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })"
          label="Date"
        />
        <VisAxis
          type="y"
          label="Tests"
          :tick-format="(d: number) => d.toString()"
        />
      </VisXYContainer>

      <div
        v-if="tooltipData"
        class="fixed z-50 pointer-events-none bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-[260px]"
        :style="{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }"
      >
        <div class="p-2 text-sm text-gray-900 dark:text-gray-100">
          <div class="font-semibold mb-1">
            {{ new Date(tooltipData.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}
          </div>
          <div class="capitalize mb-1">
            Status: {{ tooltipData.status }}
          </div>
          <div class="space-y-0.5">
            <div><span class="text-green-500 dark:text-green-400">&#9679;</span> Passed: {{ tooltipData.passed }}</div>
            <div><span class="text-red-500 dark:text-red-400">&#9679;</span> Failed: {{ tooltipData.failed }}</div>
            <div><span class="text-orange-500 dark:text-orange-400">&#9679;</span> Skipped: {{ tooltipData.skipped }}</div>
            <div><span class="text-purple-500 dark:text-purple-400">&#9679;</span> Flaky: {{ tooltipData.flaky }}</div>
            <div class="font-medium mt-1">
              Total: {{ tooltipData.total }}
            </div>
          </div>
          <div class="text-gray-400 dark:text-gray-500 text-xs mt-1">
            Click to view run details
          </div>
        </div>
      </div>
    </div>

    <div v-else class="text-center py-12 text-gray-500">
      <p>No test run data available to display chart</p>
    </div>

    <div class="flex items-center justify-center gap-6 mt-4 text-sm">
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-green-500" />
        <span>Passed</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-red-500" />
        <span>Failed</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-orange-500" />
        <span>Skipped</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-purple-600" />
        <span>Flaky</span>
      </div>
    </div>
  </div>
</template>

<style>
.unovis-xy-container {
  font-family: inherit;
}
</style>
