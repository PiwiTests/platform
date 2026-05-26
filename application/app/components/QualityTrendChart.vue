<script setup lang="ts">
import { VisXYContainer, VisLine, VisAxis, VisTooltip, VisStackedBar } from '@unovis/vue'
import { CurveType } from '@unovis/ts'
import type { QualityTrendPoint } from '~~/types/api'

interface Props {
  data: QualityTrendPoint[]
  height?: number
  mode?: 'flakiness' | 'failure'
}

const props = withDefaults(defineProps<Props>(), {
  height: 300,
  mode: 'flakiness'
})

type DataPoint = {
  date: Date
  flakyTests: number
  failedTests: number
  totalTests: number
  failureRate: number
  flakyRate: number
  status: string
}

const chartData = computed(() => {
  if (!props.data || props.data.length === 0) return []

  return props.data.map(point => ({
    date: new Date(point.startTime),
    flakyTests: point.flakyTests,
    failedTests: point.failedTests,
    totalTests: point.totalTests,
    failureRate: point.failureRate,
    flakyRate: point.flakyRate,
    status: point.status
  })).sort((a, b) => a.date.getTime() - b.date.getTime())
})

const x = (d: DataPoint) => d.date

// Flakiness mode accessors
const yFlakyTests = (d: DataPoint) => d.flakyTests
const yFlakyRate = (d: DataPoint) => d.flakyRate

// Failure mode accessors
const yFailureRate = (d: DataPoint) => d.failureRate
const yFailedTests = (d: DataPoint) => d.failedTests
</script>

<template>
  <div v-if="chartData.length > 0" class="w-full">
    <!-- Flakiness mode -->
    <template v-if="mode === 'flakiness'">
      <VisXYContainer
        :data="chartData"
        :height="height"
        :padding="{ top: 10, right: 60, bottom: 40, left: 60 }"
      >
        <VisStackedBar
          :x="x"
          :y="[yFlakyTests]"
          :color="['rgb(234, 179, 8)']"
          :bar-padding="0.3"
        />
        <VisLine
          :x="x"
          :y="[yFlakyRate]"
          :color="['rgb(249, 115, 22)']"
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
          label="Flaky tests"
        />

        <VisTooltip />
      </VisXYContainer>

      <div class="flex items-center justify-center gap-6 mt-4 text-sm">
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded bg-yellow-500" />
          <span>Flaky tests (count)</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded-full bg-orange-500" />
          <span>Flaky rate (%)</span>
        </div>
      </div>
    </template>

    <!-- Failure mode -->
    <template v-else>
      <VisXYContainer
        :data="chartData"
        :height="height"
        :padding="{ top: 10, right: 60, bottom: 40, left: 60 }"
      >
        <VisStackedBar
          :x="x"
          :y="[yFailedTests]"
          :color="['rgb(239, 68, 68)']"
          :bar-padding="0.3"
        />
        <VisLine
          :x="x"
          :y="[yFailureRate]"
          :color="['rgb(234, 179, 8)']"
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
          label="Failed tests"
        />

        <VisTooltip />
      </VisXYContainer>

      <div class="flex items-center justify-center gap-6 mt-4 text-sm">
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded bg-red-500" />
          <span>Failed tests (count)</span>
        </div>
        <div class="flex items-center gap-2">
          <div class="w-3 h-3 rounded-full bg-yellow-500" />
          <span>Failure rate (%)</span>
        </div>
      </div>
    </template>
  </div>

  <div v-else class="text-center py-12 text-gray-500">
    <p>No quality data available to display chart</p>
  </div>
</template>
