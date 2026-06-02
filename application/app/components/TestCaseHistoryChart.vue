<script setup lang="ts">
import { VisXYContainer, VisLine, VisAxis } from '@unovis/vue'
import { CurveType } from '@unovis/ts'
import type { TestCaseHistoryPoint } from '~~/types/api'

interface Props {
  data: TestCaseHistoryPoint[]
  height?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 200
})

const chartData = computed(() => {
  if (!props.data || props.data.length === 0) return []
  // Show chronologically oldest → newest for chart
  const sorted = [...props.data].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  )
  return sorted.map(point => ({
    id: point.id,
    runId: point.runId,
    date: new Date(point.startTime),
    duration: point.duration ?? undefined,
    status: point.status,
    runStatus: point.runStatus
  }))
})

type DataPoint = {
  id: number
  runId: number
  date: Date
  duration: number | undefined
  status: string
  runStatus: string
}

const x = (d: DataPoint) => d.date
const y = (d: DataPoint) => d.duration

const lineColor = 'rgb(148, 163, 184)'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const xyContainerRef = ref<any>(null)
const tooltipData = ref<DataPoint | null>(null)
const tooltipPos = ref({ x: 0, y: 0 })

const statusColor = (status: string): string => {
  if (status === 'passed') return 'rgb(34, 197, 94)'
  if (status === 'failed' || status === 'timedOut') return 'rgb(239, 68, 68)'
  return 'rgb(156, 163, 175)'
}

const NS = 'http://www.w3.org/2000/svg'

function onChartRender(
  svgNode: SVGSVGElement,
  margin: { top: number, bottom: number, left: number, right: number },
  _bleed: unknown,
  _containerW: number,
  _containerH: number,
  _width: number,
  _height: number
) {
  const container = xyContainerRef.value?.component
  if (!container || !chartData.value.length) return

  svgNode.querySelectorAll('.chart-marker').forEach(el => el.remove())

  const xScale = container.xScale
  const yScale = container.yScale
  if (!xScale || !yScale) return

  const group = document.createElementNS(NS, 'g')
  group.setAttribute('class', 'chart-marker')
  group.setAttribute('transform', `translate(${margin.left},${margin.top})`)
  svgNode.appendChild(group)

  for (const point of chartData.value) {
    if (point.duration === undefined) continue
    const cx = xScale(point.date)
    const cy = yScale(point.duration)
    const color = statusColor(point.status)

    const circle = document.createElementNS(NS, 'circle')
    circle.setAttribute('cx', String(cx))
    circle.setAttribute('cy', String(cy))
    circle.setAttribute('r', '5')
    circle.setAttribute('fill', color)
    circle.setAttribute('stroke', '#fff')
    circle.setAttribute('stroke-width', '2')
    circle.setAttribute('cursor', 'pointer')
    circle.addEventListener('click', () => navigateTo(`/test-runs/${point.runId}`))
    circle.addEventListener('mouseenter', () => {
      circle.setAttribute('r', '8')
      circle.setAttribute('stroke-width', '3')
      tooltipData.value = point
    })
    circle.addEventListener('mousemove', (e: MouseEvent) => {
      tooltipPos.value = { x: e.offsetX, y: e.offsetY }
    })
    circle.addEventListener('mouseleave', () => {
      circle.setAttribute('r', '5')
      circle.setAttribute('stroke-width', '2')
      tooltipData.value = null
    })
    group.appendChild(circle)
  }
}
</script>

<template>
  <div class="w-full relative">
    <div v-if="chartData.length > 0">
      <VisXYContainer
        ref="xyContainerRef"
        :data="chartData"
        :height="height"
        :padding="{ top: 10, right: 10, bottom: 30, left: 60 }"
        :on-render-complete="onChartRender"
      >
        <VisLine
          :x="x"
          :y="y"
          :color="[lineColor]"
          :curve-type="CurveType.MonotoneX"
          :line-width="1.5"
        />

        <VisAxis
          type="x"
          :tick-format="(d: Date) => (new Date(d)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })"
        />
        <VisAxis
          type="y"
          label="Duration (ms)"
          :tick-format="(d: number) => `${d}ms`"
        />
      </VisXYContainer>

      <div
        v-if="tooltipData"
        class="fixed z-50 pointer-events-none bg-white rounded-lg shadow-lg border border-gray-200"
        :style="{ left: `${tooltipPos.x + 10}px`, top: `${tooltipPos.y - 10}px` }"
      >
        <div class="p-2 text-sm">
          <div class="font-semibold mb-1">
            {{ new Date(tooltipData.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) }}
          </div>
          <div class="space-y-0.5">
            <div>
              Status:
              <span
                class="font-medium capitalize"
                :class="tooltipData.status === 'passed' ? 'text-green-600' : tooltipData.status === 'failed' || tooltipData.status === 'timedOut' ? 'text-red-600' : ''"
              >{{ tooltipData.status }}</span>
            </div>
            <div>Duration: {{ tooltipData.duration }}ms</div>
            <div v-if="tooltipData.runStatus" class="text-gray-400 text-xs">
              Run status: {{ tooltipData.runStatus }}
            </div>
          </div>
          <div class="text-gray-400 text-xs mt-1">
            Click to view run details
          </div>
        </div>
      </div>
    </div>

    <div v-else class="text-center py-8 text-gray-500">
      <p>No history data available to display chart</p>
    </div>

    <div class="flex items-center justify-center gap-4 mt-2 text-xs text-gray-500">
      <span class="flex items-center gap-1">
        <span class="w-2.5 h-2.5 rounded-full bg-green-500 inline-block" />
        Passed
      </span>
      <span class="flex items-center gap-1">
        <span class="w-2.5 h-2.5 rounded-full bg-red-500 inline-block" />
        Failed
      </span>
      <span class="flex items-center gap-1">
        <span class="w-2.5 h-2.5 rounded-full bg-gray-400 inline-block" />
        Skipped
      </span>
    </div>
  </div>
</template>
