<script setup lang="ts">
import { VisXYContainer, VisLine, VisAxis } from '@unovis/vue';
import { CurveType } from '@unovis/ts';
import type { TestCaseHistoryPoint } from '~~/types/api';

interface Props {
  data: TestCaseHistoryPoint[];
  height?: number;
}

const props = withDefaults(defineProps<Props>(), {
  height: 200,
});

const chartData = computed(() => {
  if (!props.data || props.data.length === 0) return [];
  // Show chronologically oldest → newest for chart
  const sorted = [...props.data].sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  return sorted.map((point) => ({
    id: point.id,
    runId: point.runId,
    date: new Date(point.startTime),
    duration: point.duration ?? undefined,
    status: point.status,
    runStatus: point.runStatus,
  }));
});

type DataPoint = {
  id: number;
  runId: number;
  date: Date;
  duration: number | undefined;
  status: string;
  runStatus: string;
};

const x = (d: DataPoint) => d.date;
const y = (d: DataPoint) => d.duration;

const lineColor = 'rgb(148, 163, 184)';

const statusColor = (status: string): string => {
  if (status === 'passed') return 'rgb(34, 197, 94)';
  if (status === 'failed' || status === 'timedOut') return 'rgb(239, 68, 68)';
  return 'rgb(156, 163, 175)';
};

const xyContainerRef = ref<UnovisContainerRef | null>(null);
const { tooltipData, tooltipPos, onRenderComplete } = useChartMarkers(xyContainerRef, chartData, {
  x: (d) => d.date,
  series: [{ y: (d) => d.duration, color: (d) => statusColor(d.status) }],
  radius: 5,
  hoverRadius: 8,
  strokeWidth: 2,
  hoverStrokeWidth: 3,
  onClick: (d) => navigateTo(`/test-runs/${d.runId}`),
});

const legendItems = [
  { color: 'rgb(34, 197, 94)', label: 'Passed' },
  { color: 'rgb(239, 68, 68)', label: 'Failed' },
  { color: 'rgb(156, 163, 175)', label: 'Skipped' },
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
        <VisLine :x="x" :y="y" :color="[lineColor]" :curve-type="CurveType.MonotoneX" :line-width="1.5" />

        <VisAxis
          type="x"
          :tick-format="(d: Date) => new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })"
        />
        <VisAxis type="y" label="Duration (ms)" :tick-format="(d: number) => `${d}ms`" />
      </VisXYContainer>

      <div
        v-if="tooltipData"
        class="fixed z-50 pointer-events-none bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700"
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
          <div class="space-y-0.5">
            <div>
              Status:
              <span
                class="font-medium capitalize"
                :class="
                  tooltipData.status === 'passed'
                    ? 'text-green-600'
                    : tooltipData.status === 'failed' || tooltipData.status === 'timedOut'
                      ? 'text-red-600'
                      : ''
                "
                >{{ tooltipData.status }}</span
              >
            </div>
            <div>Duration: {{ tooltipData.duration }}ms</div>
            <div v-if="tooltipData.runStatus" class="text-gray-400 text-xs">
              Run status: {{ tooltipData.runStatus }}
            </div>
          </div>
          <div class="text-gray-400 text-xs mt-1">Click to view run details</div>
        </div>
      </div>
    </div>

    <EmptyState v-else text="No history data available to display chart" />

    <ChartLegend :items="legendItems" dense />
  </div>
</template>
