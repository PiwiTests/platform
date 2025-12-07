<script setup lang="ts">
import { VisXYContainer, VisArea, VisAxis, VisTooltip, VisLine } from '@unovis/vue'
import { CurveType } from '@unovis/ts'

interface TestRun {
  id: number
  status: string
  startTime: string | Date
  passedTests: number
  failedTests: number
  skippedTests: number
  totalTests: number
}

interface Props {
  testRuns: TestRun[]
  height?: number
}

const props = withDefaults(defineProps<Props>(), {
  height: 300
})

// Transform test runs data for the chart
const chartData = computed(() => {
  if (!props.testRuns || props.testRuns.length === 0) {
    return []
  }

  // Sort by date and take last 30 runs
  const sortedRuns = [...props.testRuns]
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(-30)

  return sortedRuns.map(run => ({
    date: new Date(run.startTime),
    passed: run.passedTests || 0,
    failed: run.failedTests || 0,
    skipped: run.skippedTests || 0,
    flaky: 0, // We don't track flaky tests yet, but adding for future
    total: run.totalTests || 0
  }))
})

// X accessor for date
const x = (d: any) => d.date

// Y accessors for each metric
const yPassed = (d: any) => d.passed
const yFailed = (d: any) => d.failed
const ySkipped = (d: any) => d.skipped

// Colors for each area
const areaColors = ['rgb(34, 197, 94)', 'rgb(239, 68, 68)', 'rgb(245, 158, 11)']

// Template for tooltip
const tooltipTemplate = (d: any) => {
  if (!d) return ''
  return `
    <div class="p-2">
      <div class="font-semibold mb-1">${d.date.toLocaleString()}</div>
      <div class="space-y-1 text-sm">
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded-full bg-green-500"></div>
          <span>Passed: ${d.passed}</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded-full bg-red-500"></div>
          <span>Failed: ${d.failed}</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded-full bg-orange-500"></div>
          <span>Skipped: ${d.skipped}</span>
        </div>
        <div class="font-medium mt-1">Total: ${d.total}</div>
      </div>
    </div>
  `
}
</script>

<template>
  <div v-if="chartData.length > 0" class="w-full">
    <VisXYContainer
      :data="chartData"
      :height="height"
      :padding="{ top: 10, right: 10, bottom: 40, left: 50 }"
    >
      <!-- Areas for stacked visualization -->
      <VisArea
        :x="x"
        :y="[yPassed, yFailed, ySkipped]"
        :color="areaColors"
        :curve-type="CurveType.MonotoneX"
      />

      <!-- Lines for better visibility -->
      <VisLine
        :x="x"
        :y="[yPassed, yFailed, ySkipped]"
        :color="areaColors"
        :curve-type="CurveType.MonotoneX"
        :line-width="2"
      />

      <!-- Axes -->
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

      <!-- Tooltip -->
      <VisTooltip />
    </VisXYContainer>

    <!-- Legend -->
    <div class="flex items-center justify-center gap-6 mt-4 text-sm">
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-green-500"></div>
        <span>Passed</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-red-500"></div>
        <span>Failed</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-orange-500"></div>
        <span>Skipped</span>
      </div>
    </div>
  </div>

  <div v-else class="text-center py-12 text-gray-500">
    <p>No test run data available to display chart</p>
  </div>
</template>

<style>
/* Unovis chart styles */
.unovis-xy-container {
  font-family: inherit;
}
</style>
