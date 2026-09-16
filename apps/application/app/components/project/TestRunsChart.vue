<script setup lang="ts">
import type { TestRunForChart, MarkerInfo } from '~~/types/api';
import {
  RUN_STATUS_SERIES,
  barGeometry,
  dayTickIndices,
  formatTickDate,
  stackSegments,
  timeToOrdinalX,
} from '~/utils/chart';

interface Props {
  testRuns: TestRunForChart[];
  height?: number;
  markers?: MarkerInfo[];
}

const props = withDefaults(defineProps<Props>(), {
  height: 150,
  markers: () => [],
});

const emit = defineEmits<{ 'marker-click': [id: number] }>();

const chartData = computed(() => {
  if (!props.testRuns || props.testRuns.length === 0) {
    return [];
  }

  const sortedRuns = [...props.testRuns]
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(-30);

  return sortedRuns.map((run) => {
    const flaky = run.flakyTests || 0;
    const passed = run.passedTests || 0;
    return {
      id: run.id,
      date: new Date(run.startTime),
      // Flaky tests are counted as a subset of passed by the reporter (they
      // passed on retry), so carve them out of the passed segment. Stacking
      // flaky on top of the full passed count would double-count them and
      // inflate the bar past the run's real total.
      passed: Math.max(0, passed - flaky),
      failed: run.failedTests || 0,
      skipped: run.skippedTests || 0,
      flaky,
      total: run.totalTests || 0,
      status: run.status,
    };
  });
});

type DataPoint = (typeof chartData)['value'][number];

const yMax = computed(() => Math.max(1, ...chartData.value.map((d) => d.passed + d.failed + d.skipped + d.flaky)));

const dates = computed(() => chartData.value.map((d) => d.date));

/** One bar per run: slot (hover column), bar x/width and stacked segments. */
function layout(plotWidth: number, plotHeight: number, yScale: (value: number) => number) {
  const geo = barGeometry(chartData.value.length, plotWidth);
  return chartData.value.map((d, i) => ({
    d,
    slotX: i * geo.slotWidth,
    slotWidth: geo.slotWidth,
    barX: geo.xOf(i),
    barWidth: geo.barWidth,
    segments: stackSegments(
      RUN_STATUS_SERIES.map((s) => ({ color: s.color, value: d[s.key] })),
      plotHeight,
      yScale,
    ),
  }));
}

function xTicks(plotWidth: number) {
  const { centerOf } = barGeometry(chartData.value.length, plotWidth);
  return dayTickIndices(dates.value, Math.max(2, Math.floor(plotWidth / 80))).map((i) => ({
    x: centerOf(i),
    label: formatTickDate(dates.value[i] as Date),
  }));
}

function markerX(plotWidth: number, occurredAt: string | Date): number | null {
  const { centerOf } = barGeometry(chartData.value.length, plotWidth);
  const centers = chartData.value.map((_, i) => centerOf(i));
  return timeToOrdinalX(dates.value, centers, new Date(occurredAt).getTime());
}

const { data: tooltipData, pos: tooltipPos, show, move, hide } = useChartTooltip<DataPoint>();
</script>

<template>
  <div class="w-full">
    <ChartFrame v-if="chartData.length > 0" v-slot="{ plotWidth, plotHeight, yScale }" :height="height" :y-max="yMax">
      <template v-for="bar in layout(plotWidth, plotHeight, yScale)" :key="bar.d.id">
        <rect
          v-for="segment in bar.segments"
          :key="segment.color"
          :x="bar.barX"
          :y="segment.y"
          :width="bar.barWidth"
          :height="segment.height"
          :fill="segment.color"
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
        v-for="bar in layout(plotWidth, plotHeight, yScale)"
        :key="`hover-${bar.d.id}`"
        :x="bar.slotX"
        :y="0"
        :width="bar.slotWidth"
        :height="plotHeight"
        :fill="tooltipData?.id === bar.d.id ? 'rgb(148 163 184 / 0.15)' : 'transparent'"
        class="cursor-pointer"
        @click="navigateTo(`/test-runs/${bar.d.id}`)"
        @mouseenter="show($event, bar.d)"
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

    <EmptyState v-else text="No test run data available to display chart" />

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
        <div><span class="text-red-500 dark:text-red-400">&#9679;</span> Failed: {{ tooltipData.failed }}</div>
        <div><span class="text-purple-500 dark:text-purple-400">&#9679;</span> Flaky: {{ tooltipData.flaky }}</div>
        <div><span class="text-orange-500 dark:text-orange-400">&#9679;</span> Skipped: {{ tooltipData.skipped }}</div>
        <div><span class="text-green-500 dark:text-green-400">&#9679;</span> Passed: {{ tooltipData.passed }}</div>
        <div class="font-medium mt-1">Total: {{ tooltipData.total }}</div>
      </div>
      <div class="text-gray-400 dark:text-gray-500 text-xs mt-1">Click to view run details</div>
    </ChartTooltip>
  </div>
</template>
