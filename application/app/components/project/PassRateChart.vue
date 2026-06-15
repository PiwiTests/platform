<script setup lang="ts">
import { VisXYContainer, VisLine, VisAxis } from '@unovis/vue';
import { CurveType } from '@unovis/ts';
import type { TestRunForChart } from '~~/types/api';

interface Props {
  testRuns: TestRunForChart[];
  height?: number;
}

const props = withDefaults(defineProps<Props>(), {
  height: 160,
});

interface DataPoint {
  id: number;
  date: Date;
  passRate: number;
  passed: number;
  failed: number;
  total: number;
  status: string;
}

const chartData = computed<DataPoint[]>(() => {
  if (!props.testRuns || props.testRuns.length === 0) return [];
  return [...props.testRuns]
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(-30)
    .map((run) => ({
      id: run.id,
      date: new Date(run.startTime),
      passRate: run.totalTests > 0 ? Math.round((run.passedTests / run.totalTests) * 100) : 0,
      passed: run.passedTests || 0,
      failed: run.failedTests || 0,
      total: run.totalTests || 0,
      status: run.status,
    }));
});

const x = (d: DataPoint) => d.date;
const y = (d: DataPoint) => d.passRate;

const color = 'rgb(34, 197, 94)';

const xyContainerRef = ref<UnovisContainerRef | null>(null);
const { tooltipData, tooltipPos, onRenderComplete } = useChartMarkers(xyContainerRef, chartData, {
  x: (d) => d.date,
  series: [{ y: (d) => d.passRate, color: (d) => (d.passRate >= 90 ? color : 'rgb(239, 68, 68)') }],
  radius: 4,
  hoverRadius: 6.5,
  tooltipWidth: 220,
  onClick: (d) => navigateTo(`/test-runs/${d.id}`),
});
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
        <VisLine :x="x" :y="y" :color="color" :curve-type="CurveType.MonotoneX" :line-width="2" />

        <VisAxis
          type="x"
          :tick-format="(d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })"
          label="Date"
        />
        <VisAxis type="y" label="" :tick-format="(d: number) => `${d}%`" />
      </VisXYContainer>

      <div
        v-if="tooltipData"
        class="fixed z-50 pointer-events-none bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-[220px]"
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
          <div class="mb-1">
            Pass rate:
            <strong :class="tooltipData.passRate >= 90 ? 'text-green-600' : 'text-red-600'"
              >{{ tooltipData.passRate }}%</strong
            >
          </div>
          <div class="space-y-0.5 text-xs">
            <div><span class="text-green-500">&#9679;</span> Passed: {{ tooltipData.passed }}</div>
            <div><span class="text-red-500">&#9679;</span> Failed: {{ tooltipData.failed }}</div>
            <div class="font-medium mt-1">Total: {{ tooltipData.total }}</div>
          </div>
          <div class="text-gray-400 text-xs mt-1">Click to view run details</div>
        </div>
      </div>
    </div>

    <EmptyState v-else text="No data available" />
  </div>
</template>
