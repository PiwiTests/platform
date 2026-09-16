<script setup lang="ts">
import type { AnalyticsWastedTime } from '#shared/analytics/types';
import { barGeometry, dayTickIndices, formatTickDate, stackSegments } from '~/utils/chart';

const props = defineProps<{ query: Record<string, string> }>();

const {
  data: wasted,
  pending,
  error,
  refresh,
} = await useAnalyticsWidget<AnalyticsWastedTime>('wasted-time', () => props.query);

type DataPoint = { date: Date; waitMinutes: number; failedExecMinutes: number };

const chartData = computed<DataPoint[]>(
  () =>
    wasted.value?.points.map((p) => ({
      date: new Date(p.date),
      waitMinutes: p.waitMinutes,
      failedExecMinutes: p.failedExecMinutes,
    })) ?? [],
);

const hasData = computed(() => chartData.value.some((p) => p.waitMinutes > 0 || p.failedExecMinutes > 0));

const areaColors = ['rgb(245, 158, 11)', 'rgb(239, 68, 68)'] as const;

const yMax = computed(() => Math.max(1, ...chartData.value.map((d) => d.waitMinutes + d.failedExecMinutes)));

/** One stacked bar per day: wait minutes on the baseline, failed-run minutes above. */
function layout(plotWidth: number, plotHeight: number, yScale: (value: number) => number) {
  const geo = barGeometry(chartData.value.length, plotWidth);
  return chartData.value.map((d, i) => ({
    d,
    slotX: i * geo.slotWidth,
    slotWidth: geo.slotWidth,
    barX: geo.xOf(i),
    barWidth: geo.barWidth,
    segments: stackSegments(
      [
        { color: areaColors[0], value: d.waitMinutes },
        { color: areaColors[1], value: d.failedExecMinutes },
      ],
      plotHeight,
      yScale,
    ),
  }));
}

function xTicks(plotWidth: number) {
  const { centerOf } = barGeometry(chartData.value.length, plotWidth);
  const dates = chartData.value.map((d) => d.date);
  return dayTickIndices(dates, Math.max(2, Math.floor(plotWidth / 80))).map((i) => ({
    x: centerOf(i),
    label: formatTickDate(dates[i] as Date),
  }));
}

const { data: tooltipData, pos: tooltipPos, show, move, hide } = useChartTooltip<DataPoint>(240);

const legendItems = [
  { color: areaColors[0], label: 'Wait steps' },
  { color: areaColors[1], label: 'Failed attempts' },
];

const subtitle = computed(() => {
  if (!wasted.value) return undefined;
  const total = wasted.value.totalWaitMinutes + wasted.value.totalFailedExecMinutes;
  const label = total < 60 ? `${Math.round(total)} min` : `${Math.round((total / 60) * 10) / 10} h`;
  return `${label} of CI time produced no signal`;
});

const reclaim = computed(() => wasted.value?.timeoutReclaimable ?? null);
const reclaimLabel = computed(() => {
  const m = reclaim.value?.estimatedMinutes ?? 0;
  return m < 60 ? `${Math.round(m)} min` : `${Math.round((m / 60) * 10) / 10} h`;
});
</script>

<template>
  <ChartCard
    icon="i-lucide-hourglass"
    title="Wasted CI time"
    :subtitle="subtitle"
    help="analytics.wasted-time"
    :legend="legendItems"
  >
    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load wasted time: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="!hasData" text="No wasted time recorded in this period." />
    <div v-else class="w-full">
      <ChartFrame
        v-slot="{ plotWidth, plotHeight, yScale }"
        :height="220"
        :y-max="yMax"
        :y-format="(value) => `${value}m`"
      >
        <template v-for="bar in layout(plotWidth, plotHeight, yScale)" :key="bar.d.date.getTime()">
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
          :key="`hover-${bar.d.date.getTime()}`"
          :x="bar.slotX"
          :y="0"
          :width="bar.slotWidth"
          :height="plotHeight"
          :fill="tooltipData === bar.d ? 'rgb(148 163 184 / 0.15)' : 'transparent'"
          @mouseenter="show($event, bar.d)"
          @mousemove="move($event)"
          @mouseleave="hide()"
        />
      </ChartFrame>

      <ChartTooltip v-if="tooltipData" :pos="tooltipPos">
        <div class="font-semibold mb-1">
          {{ tooltipData.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}
        </div>
        <div><span class="text-amber-500">&#9679;</span> Wait steps: {{ tooltipData.waitMinutes }} min</div>
        <div><span class="text-red-500">&#9679;</span> Failed attempts: {{ tooltipData.failedExecMinutes }} min</div>
      </ChartTooltip>

      <div
        v-if="reclaim"
        class="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-2.5 text-sm dark:border-amber-900/50 dark:bg-amber-950/30"
      >
        <UIcon name="i-lucide-scissors" class="mt-0.5 shrink-0 text-amber-500" />
        <div class="text-gray-700 dark:text-gray-300">
          Up to <span class="font-semibold">≈{{ reclaimLabel }}</span> of this is avoidable —
          {{ reclaim.oversizedCount }} oversized {{ reclaim.oversizedCount === 1 ? 'timeout' : 'timeouts' }} and
          {{ reclaim.staleSlowCount }} stale <code class="text-xs">test.slow()</code>
          {{ reclaim.staleSlowCount === 1 ? 'mark' : 'marks' }} inflate the failed-attempt time above.
          <NuxtLink
            v-if="reclaim.topProjectId"
            :to="`/projects/${reclaim.topProjectId}#performance`"
            class="text-primary hover:underline"
            >Review</NuxtLink
          >
        </div>
      </div>

      <div v-if="wasted && wasted.byProject.length > 0" class="mt-4 space-y-1">
        <div
          v-for="project in wasted.byProject.slice(0, 5)"
          :key="project.projectId"
          class="flex items-center justify-between text-sm"
        >
          <NuxtLink :to="`/projects/${project.projectId}`" class="truncate hover:text-primary">
            {{ project.label || project.name }}
          </NuxtLink>
          <span class="tabular-nums text-gray-500 dark:text-gray-400 shrink-0">
            {{ Math.round(project.waitMinutes + project.failedExecMinutes) }} min
          </span>
        </div>
      </div>
    </div>
  </ChartCard>
</template>
