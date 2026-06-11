<script setup lang="ts">
import { VisXYContainer, VisLine, VisAxis } from '@unovis/vue'
import { CurveType } from '@unovis/ts'
import type { TestRunForChart } from '~~/types/api'

interface Props {
  testRuns: TestRunForChart[]
  height?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 160
})

interface DataPoint {
  id: number
  date: Date
  passRate: number
  passed: number
  failed: number
  total: number
  status: string
}

const chartData = computed<DataPoint[]>(() => {
  if (!props.testRuns || props.testRuns.length === 0) return []
  return [...props.testRuns]
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(-30)
    .map(run => ({
      id: run.id,
      date: new Date(run.startTime),
      passRate: run.totalTests > 0 ? Math.round((run.passedTests / run.totalTests) * 100) : 0,
      passed: run.passedTests || 0,
      failed: run.failedTests || 0,
      total: run.totalTests || 0,
      status: run.status,
    }))
})

const x = (d: DataPoint) => d.date
const y = (d: DataPoint) => d.passRate

const color = 'rgb(34, 197, 94)'

const xyContainerRef = useTemplateRef('xyContainerRef')
const tooltipData = ref<DataPoint | null>(null)
const tooltipPos = ref({ x: 0, y: 0 })

const NS = 'http://www.w3.org/2000/svg'

function addMarkers(
  svgNode: SVGSVGElement,
  margin: { top: number, bottom: number, left: number, right: number }
) {
  svgNode.querySelectorAll('.chart-marker').forEach(el => el.remove())

  const container = xyContainerRef.value?.component
  if (!container || !chartData.value.length) return

  const comp = container.components?.[0]
  const xScale = comp?.xScale
  const yScale = comp?.yScale
  if (!xScale || !yScale) return

  const group = document.createElementNS(NS, 'g')
  group.setAttribute('class', 'chart-marker')
  group.setAttribute('transform', `translate(${margin.left},${margin.top})`)
  svgNode.appendChild(group)

  for (const point of chartData.value) {
    const cx = xScale(point.date)
    const cy = yScale(point.passRate)
    const circle = document.createElementNS(NS, 'circle')
    circle.setAttribute('cx', String(cx))
    circle.setAttribute('cy', String(cy))
    circle.setAttribute('r', '4')
    circle.setAttribute('fill', point.passRate >= 90 ? color : 'rgb(239, 68, 68)')
    circle.setAttribute('stroke', '#fff')
    circle.setAttribute('stroke-width', '1.5')
    circle.setAttribute('cursor', 'pointer')
    circle.addEventListener('click', () => navigateTo(`/test-runs/${point.id}`))
    circle.addEventListener('mouseenter', () => {
      circle.setAttribute('r', '6.5')
      circle.setAttribute('stroke-width', '2.5')
      tooltipData.value = point
    })
    circle.addEventListener('mousemove', (e: MouseEvent) => {
      const tw = 220
      const ox = 12
      const x = e.clientX + ox + tw > window.innerWidth - 8 ? e.clientX - tw - ox : e.clientX + ox
      tooltipPos.value = { x, y: e.clientY - 12 }
    })
    circle.addEventListener('mouseleave', () => {
      circle.setAttribute('r', '4')
      circle.setAttribute('stroke-width', '1.5')
      tooltipData.value = null
    })
    group.appendChild(circle)
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
        <VisLine
          :x="x"
          :y="y"
          :color="color"
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
          label=""
          :tick-format="(d: number) => `${d}%`"
        />
      </VisXYContainer>

      <div
        v-if="tooltipData"
        class="fixed z-50 pointer-events-none bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-[220px]"
        :style="{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }"
      >
        <div class="p-2 text-sm text-gray-900 dark:text-gray-100">
          <div class="font-semibold mb-1">
            {{ new Date(tooltipData.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}
          </div>
          <div class="mb-1">
            Pass rate: <strong :class="tooltipData.passRate >= 90 ? 'text-green-600' : 'text-red-600'">{{ tooltipData.passRate }}%</strong>
          </div>
          <div class="space-y-0.5 text-xs">
            <div><span class="text-green-500">&#9679;</span> Passed: {{ tooltipData.passed }}</div>
            <div><span class="text-red-500">&#9679;</span> Failed: {{ tooltipData.failed }}</div>
            <div class="font-medium mt-1">
              Total: {{ tooltipData.total }}
            </div>
          </div>
          <div class="text-gray-400 text-xs mt-1">
            Click to view run details
          </div>
        </div>
      </div>
    </div>

    <div v-else class="text-center py-8 text-gray-500">
      No data available
    </div>
  </div>
</template>
