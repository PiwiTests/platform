<script setup lang="ts">
import { VisXYContainer, VisLine, VisAxis } from '@unovis/vue';
import { CurveType } from '@unovis/ts';
import type { PerformanceTrendPoint } from '~~/types/api';

interface Props {
  data: PerformanceTrendPoint[];
  height?: number;
}

const props = withDefaults(defineProps<Props>(), {
  height: 300,
});

const chartData = computed(() => {
  if (!props.data || props.data.length === 0) {
    return [];
  }

  return props.data.map((point) => ({
    id: point.id,
    date: new Date(point.startTime),
    duration: point.duration ? Math.round(point.duration / 1000) : null,
    avgTestDuration: point.avgTestDuration ? Math.round(point.avgTestDuration / 1000) : null,
    p90TestDuration: point.p90TestDuration ? Math.round(point.p90TestDuration / 1000) : null,
    commit: point.commit ? point.commit.substring(0, 7) : null,
    status: point.status,
    totalTests: point.totalTests,
  }));
});

type DataPoint = {
  id: number;
  date: Date;
  duration: number | null;
  avgTestDuration: number | null;
  p90TestDuration: number | null;
  commit: string | null;
  status: string;
  totalTests: number;
};

const x = (d: DataPoint) => d.date;

const yDuration = (d: DataPoint) => d.duration ?? undefined;
const yAvgDuration = (d: DataPoint) => d.avgTestDuration ?? undefined;
const yP90Duration = (d: DataPoint) => d.p90TestDuration ?? undefined;

const lineColors = ['rgb(59, 130, 246)', 'rgb(34, 197, 94)', 'rgb(249, 115, 22)'] as const;

const xyContainerRef = ref<UnovisContainerRef | null>(null);
const { tooltipData, tooltipPos, onRenderComplete } = useChartMarkers(xyContainerRef, chartData, {
  x: (d) => d.date,
  series: [
    { y: (d) => d.duration, color: lineColors[0] },
    { y: (d) => d.avgTestDuration, color: lineColors[1] },
    { y: (d) => d.p90TestDuration, color: lineColors[2] },
  ],
  onClick: (d) => navigateTo(`/test-runs/${d.id}`),
});

const legendItems = [
  { color: lineColors[0], label: 'Total Duration' },
  { color: lineColors[1], label: 'Avg Test Duration' },
  { color: lineColors[2], label: 'P90 Test Duration' },
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
        <VisLine
          :x="x"
          :y="[yDuration, yAvgDuration, yP90Duration]"
          :color="lineColors"
          :curve-type="CurveType.MonotoneX"
          :line-width="2"
        />

        <VisAxis
          type="x"
          :tick-format="(d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })"
          label="Date"
        />
        <VisAxis type="y" label="Duration (s)" :tick-format="(d: number) => `${d}s`" />
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
            <div>
              <span class="text-blue-500 dark:text-blue-400">&#9679;</span> Total: {{ tooltipData.duration ?? '-' }}s
            </div>
            <div>
              <span class="text-green-500 dark:text-green-400">&#9679;</span> Avg:
              {{ tooltipData.avgTestDuration ?? '-' }}s
            </div>
            <div>
              <span class="text-orange-500 dark:text-orange-400">&#9679;</span> P90:
              {{ tooltipData.p90TestDuration ?? '-' }}s
            </div>
            <div class="mt-1">Tests: {{ tooltipData.totalTests }}</div>
            <div v-if="tooltipData.commit" class="text-gray-400 dark:text-gray-500 text-xs">
              Commit: {{ tooltipData.commit }}
            </div>
          </div>
          <div class="text-gray-400 dark:text-gray-500 text-xs mt-1">Click to view run details</div>
        </div>
      </div>
    </div>

    <EmptyState v-else text="No performance data available to display chart" />

    <ChartLegend :items="legendItems" />
  </div>
</template>
