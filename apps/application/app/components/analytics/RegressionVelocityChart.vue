<script setup lang="ts">
import type { AnalyticsRegressionVelocity } from '#shared/analytics/types';
import { barGeometry, bucketTimeToX, dayTickIndices, formatTickDate, stackSegments } from '~/utils/chart';

const props = defineProps<{ query: Record<string, string> }>();

const {
  data: velocity,
  pending,
  error,
  refresh,
} = await useAnalyticsWidget<AnalyticsRegressionVelocity>('regression-velocity', () => props.query);

type DataPoint = { date: Date; regressions: number; newFlaky: number };

const chartData = computed<DataPoint[]>(
  () =>
    velocity.value?.points.map((p) => ({
      date: new Date(p.date),
      regressions: p.regressions,
      newFlaky: p.newFlaky,
    })) ?? [],
);

const hasData = computed(() => chartData.value.some((p) => p.regressions > 0 || p.newFlaky > 0));

const barColors = [STATUS_PALETTE.failed.color, STATUS_PALETTE.flaky.color] as const;

const yMax = computed(() => Math.max(1, ...chartData.value.map((d) => d.regressions + d.newFlaky)));

/** One stacked bar per day: regressions on the baseline, newly flaky above. */
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
        { color: barColors[0], value: d.regressions },
        { color: barColors[1], value: d.newFlaky },
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
  { color: barColors[0], label: 'New regressions' },
  { color: barColors[1], label: 'Newly flaky' },
];

const deltaBadge = computed(() => {
  if (!velocity.value || velocity.value.deltaPct === null) return null;
  const pct = velocity.value.deltaPct;
  return {
    label: `${pct > 0 ? '+' : ''}${pct}% vs previous period`,
    // Fewer regressions is good, more is bad.
    class: pct > 0 ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400',
  };
});

const exportData = computed(() =>
  velocity.value
    ? {
        name: 'regression-velocity',
        header: ['date', 'new regressions', 'newly flaky'],
        rows: velocity.value.points.map((p) => [p.date, p.regressions, p.newFlaky]),
      }
    : null,
);

const subtitle = computed(() => {
  if (!velocity.value) return undefined;
  return `${velocity.value.totalRegressions} new regressions, ${velocity.value.totalNewFlaky} newly flaky`;
});
// Timeline markers of the period, drawn over the bars (provided by the analytics page).
const scopeSummary = injectAnalyticsScopeSummary();
const markers = computed(() => scopeSummary.value?.markers ?? []);
function markerX(plotWidth: number, occurredAt: string | Date): number | null {
  const { centerOf } = barGeometry(chartData.value.length, plotWidth);
  const end = scopeSummary.value ? new Date(scopeSummary.value.period.to).getTime() : Date.now();
  return bucketTimeToX(
    chartData.value.map((d) => d.date),
    chartData.value.map((_, i) => centerOf(i)),
    new Date(occurredAt).getTime(),
    end,
  );
}

/** With one project in scope, a bucket opens that project's runs of those days. */
const drill = computed(() => (velocity.value ? bucketDrill(props.query, velocity.value.bucketDays) : null));
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}
</script>

<template>
  <ChartCard
    icon="i-lucide-git-pull-request-arrow"
    title="Regression velocity"
    :subtitle="subtitle"
    help="analytics.regression-velocity"
    :legend="legendItems"
    :export-data="exportData"
  >
    <template #actions>
      <span v-if="deltaBadge" class="text-xs font-medium tabular-nums" :class="deltaBadge.class">
        {{ deltaBadge.label }}
      </span>
    </template>

    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load regression velocity: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="!hasData" icon="i-lucide-shield-check" text="No new regressions in this period." />
    <div v-else class="w-full">
      <ChartFrame v-slot="{ plotWidth, plotHeight, yScale }" :height="220" :y-max="yMax">
        <template v-for="bar in layout(plotWidth, plotHeight, yScale)" :key="bar.d.date.getTime()">
          <rect
            v-for="segment in bar.segments"
            :key="segment.color"
            :x="bar.barX"
            :y="segment.y"
            :width="bar.barWidth"
            :height="segment.height"
            :style="{ fill: segment.color }"
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
          :class="drill ? 'cursor-pointer' : ''"
          @click="drill && navigateTo(drill(isoDay(bar.d.date)))"
          @mouseenter="show($event, bar.d)"
          @mousemove="move($event)"
          @mouseleave="hide()"
        />
        <ChartMarkerLines
          :markers="markers"
          :x-of="(occurredAt) => markerX(plotWidth, occurredAt)"
          :plot-height="plotHeight"
        />
      </ChartFrame>

      <ChartTooltip v-if="tooltipData" :pos="tooltipPos">
        <div class="font-semibold mb-1">
          {{ tooltipData.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) }}
        </div>
        <div><span :style="{ color: barColors[0] }">&#9679;</span> New regressions: {{ tooltipData.regressions }}</div>
        <div><span :style="{ color: barColors[1] }">&#9679;</span> Newly flaky: {{ tooltipData.newFlaky }}</div>
      </ChartTooltip>
    </div>
  </ChartCard>
</template>
