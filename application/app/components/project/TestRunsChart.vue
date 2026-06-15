<script setup lang="ts">
import { VisXYContainer, VisArea, VisAxis, VisLine } from '@unovis/vue';
import { CurveType } from '@unovis/ts';
import type { TestRunForChart } from '~~/types/api';

interface Props {
  testRuns: TestRunForChart[];
  height?: number;
}

const props = withDefaults(defineProps<Props>(), {
  height: 300,
});

const chartData = computed(() => {
  if (!props.testRuns || props.testRuns.length === 0) {
    return [];
  }

  const sortedRuns = [...props.testRuns]
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(-30);

  return sortedRuns.map((run) => ({
    id: run.id,
    date: new Date(run.startTime),
    passed: run.passedTests || 0,
    failed: run.failedTests || 0,
    skipped: run.skippedTests || 0,
    flaky: run.flakyTests || 0,
    total: run.totalTests || 0,
    status: run.status,
  }));
});

type DataPoint = {
  id: number;
  date: Date;
  passed: number;
  failed: number;
  skipped: number;
  flaky: number;
  total: number;
  status: string;
};

const x = (d: DataPoint) => d.date;

const yPassed = (d: DataPoint) => d.passed;
const yFailed = (d: DataPoint) => d.failed;
const ySkipped = (d: DataPoint) => d.skipped;
const yFlaky = (d: DataPoint) => d.flaky;

const areaColors = ['rgb(34, 197, 94)', 'rgb(239, 68, 68)', 'rgb(245, 158, 11)', 'rgb(147, 51, 234)'] as const;

const xyContainerRef = ref<UnovisContainerRef | null>(null);
const { tooltipData, tooltipPos, onRenderComplete } = useChartMarkers(xyContainerRef, chartData, {
  x: (d) => d.date,
  series: [
    { y: (d) => d.passed, color: areaColors[0] },
    { y: (d) => d.failed, color: areaColors[1] },
    { y: (d) => d.skipped, color: areaColors[2] },
    { y: (d) => d.flaky, color: areaColors[3] },
  ],
  onClick: (d) => navigateTo(`/test-runs/${d.id}`),
});

const legendItems = [
  { color: areaColors[0], label: 'Passed' },
  { color: areaColors[1], label: 'Failed' },
  { color: areaColors[2], label: 'Skipped' },
  { color: areaColors[3], label: 'Flaky' },
];
</script>

<template>
  <div class="w-full relative">
    <div v-if="chartData.length > 0">
      <VisXYContainer
        ref="xyContainerRef"
        :data="chartData"
        :height="height"
        :padding="{ top: 10, right: 10, bottom: 0, left: 0 }"
        :on-render-complete="onRenderComplete"
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
          :tick-format="(d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })"
          label="Date"
        />
        <VisAxis type="y" label="Tests" :tick-format="(d: number) => d.toString()" />
      </VisXYContainer>

      <div
        v-if="tooltipData"
        class="fixed z-50 pointer-events-none bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-[260px]"
        :style="{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }"
      >
        <div class="p-2 text-sm text-gray-900 dark:text-gray-100">
          <div class="font-semibold mb-1">
            {{
              new Date(tooltipData.date).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                hour: '2-digit',
                minute: '2-digit',
              })
            }}
          </div>
          <div class="capitalize mb-1">Status: {{ tooltipData.status }}</div>
          <div class="space-y-0.5">
            <div><span class="text-green-500 dark:text-green-400">&#9679;</span> Passed: {{ tooltipData.passed }}</div>
            <div><span class="text-red-500 dark:text-red-400">&#9679;</span> Failed: {{ tooltipData.failed }}</div>
            <div>
              <span class="text-orange-500 dark:text-orange-400">&#9679;</span> Skipped: {{ tooltipData.skipped }}
            </div>
            <div><span class="text-purple-500 dark:text-purple-400">&#9679;</span> Flaky: {{ tooltipData.flaky }}</div>
            <div class="font-medium mt-1">Total: {{ tooltipData.total }}</div>
          </div>
          <div class="text-gray-400 dark:text-gray-500 text-xs mt-1">Click to view run details</div>
        </div>
      </div>
    </div>

    <EmptyState v-else text="No test run data available to display chart" />

    <ChartLegend :items="legendItems" />
  </div>
</template>

<style>
.unovis-xy-container {
  font-family: inherit;
}
</style>
