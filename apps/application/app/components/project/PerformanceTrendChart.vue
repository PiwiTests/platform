<script setup lang="ts">
import type { PerformanceTrendPoint, MarkerInfo } from '~~/types/api';
import { RUN_DURATION_SERIES, barGeometry, dayTickIndices, formatTickDate, timeToOrdinalX } from '~/utils/chart';

interface Props {
  data: PerformanceTrendPoint[];
  height?: number;
  markers?: MarkerInfo[];
}

const props = withDefaults(defineProps<Props>(), {
  height: 260,
  markers: () => [],
});

const emit = defineEmits<{ 'marker-click': [id: number] }>();

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

type DataPoint = (typeof chartData)['value'][number];

const yMax = computed(() =>
  Math.max(1, ...chartData.value.flatMap((d) => RUN_DURATION_SERIES.map((s) => d[s.key] ?? 0))),
);

const dates = computed(() => chartData.value.map((d) => d.date));

function centers(plotWidth: number): number[] {
  const { centerOf } = barGeometry(chartData.value.length, plotWidth);
  return chartData.value.map((_, i) => centerOf(i));
}

/** Straight-segment path through the non-null points; breaks at gaps. */
function linePath(
  key: (typeof RUN_DURATION_SERIES)[number]['key'],
  plotWidth: number,
  yScale: (value: number) => number,
): string {
  const xs = centers(plotWidth);
  let path = '';
  let penDown = false;
  chartData.value.forEach((d, i) => {
    const value = d[key];
    if (value == null) {
      penDown = false;
      return;
    }
    path += `${penDown ? 'L' : 'M'}${xs[i]},${yScale(value)}`;
    penDown = true;
  });
  return path;
}

function points(
  key: (typeof RUN_DURATION_SERIES)[number]['key'],
  plotWidth: number,
  yScale: (value: number) => number,
) {
  const xs = centers(plotWidth);
  return chartData.value.flatMap((d, i) => {
    const value = d[key];
    return value == null ? [] : [{ id: d.id, x: xs[i] as number, y: yScale(value) }];
  });
}

function xTicks(plotWidth: number) {
  const { centerOf } = barGeometry(chartData.value.length, plotWidth);
  return dayTickIndices(dates.value, Math.max(2, Math.floor(plotWidth / 80))).map((i) => ({
    x: centerOf(i),
    label: formatTickDate(dates.value[i] as Date),
  }));
}

function markerX(plotWidth: number, occurredAt: string | Date): number | null {
  return timeToOrdinalX(dates.value, centers(plotWidth), new Date(occurredAt).getTime());
}

const { data: tooltipData, pos: tooltipPos, show, move, hide } = useChartTooltip<DataPoint>();
</script>

<template>
  <div class="w-full">
    <ChartFrame
      v-if="chartData.length > 0"
      v-slot="{ plotWidth, plotHeight, yScale }"
      :height="height"
      :y-max="yMax"
      :y-format="(value) => `${value}s`"
    >
      <template v-for="series in RUN_DURATION_SERIES" :key="series.key">
        <path :d="linePath(series.key, plotWidth, yScale)" fill="none" :stroke="series.color" stroke-width="2" />
        <circle
          v-for="point in points(series.key, plotWidth, yScale)"
          :key="point.id"
          :cx="point.x"
          :cy="point.y"
          r="3"
          :fill="series.color"
        />
      </template>

      <text
        v-for="tick in xTicks(plotWidth)"
        :key="tick.x"
        :x="tick.x"
        :y="plotHeight + 14"
        text-anchor="middle"
        class="fill-gray-400 dark:fill-gray-500 text-[10px]"
      >
        {{ tick.label }}
      </text>

      <rect
        v-for="(d, i) in chartData"
        :key="`hover-${d.id}`"
        :x="i * (plotWidth / chartData.length)"
        :y="0"
        :width="plotWidth / chartData.length"
        :height="plotHeight"
        :fill="tooltipData?.id === d.id ? 'rgb(148 163 184 / 0.15)' : 'transparent'"
        class="cursor-pointer"
        @click="navigateTo(`/test-runs/${d.id}`)"
        @mouseenter="show($event, d)"
        @mousemove="move($event)"
        @mouseleave="hide()"
      />

      <!-- Markers render after the hover columns so their flags stay on top
           and hover/click reach them (SVG paints in document order). -->
      <ChartMarkerLines
        :markers="markers"
        :x-of="(occurredAt) => markerX(plotWidth, occurredAt)"
        :plot-height="plotHeight"
        @marker-click="emit('marker-click', $event)"
      />
    </ChartFrame>

    <EmptyState v-else text="No performance data available to display chart" />

    <ChartTooltip v-if="tooltipData" :pos="tooltipPos">
      <div class="font-semibold mb-1">
        {{
          tooltipData.date.toLocaleDateString('en-US', {
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
          <span class="text-green-500 dark:text-green-400">&#9679;</span> Avg: {{ tooltipData.avgTestDuration ?? '-' }}s
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
    </ChartTooltip>
  </div>
</template>
