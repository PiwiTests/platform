<script setup lang="ts">
/**
 * The displays of the metric widget beyond the single line: bars over time,
 * a table of buckets, a heatmap row, and, with a breakdown, a bar, a table
 * row, a line or a heatmap row per group. Presentational: `MetricTrendChart`
 * fetches the data and draws the plain line and the stat.
 */
import type { AnalyticsMetricValue, AnalyticsMetricWidget, AnalyticsSeriesPoint } from '#shared/analytics/types';
import { barGeometry, dayTickIndices, formatTickDate, GROUP_SERIES_COLORS } from '~/utils/chart';

const props = defineProps<{ widget: AnalyticsMetricWidget }>();

const f = computed(() => metricFormatter());
const unit = computed(() => props.widget.value);
/** Bars and heatmap cells of a count: the first series color, never an outcome color. */
const BAR_COLOR = GROUP_SERIES_COLORS[0];

function valueText(value: number | null): string {
  const v = unit.value;
  return f.value.value(value, v.unit, v.precision, v.currency);
}

function yFormat(value: number): string {
  const u = unit.value.unit;
  return u === 'percent' ? `${value}%` : u === 'minutes' ? `${value}m` : String(value);
}

const groups = computed(() => props.widget.breakdown?.groups ?? []);
const lineGroups = computed(() =>
  groups.value.filter((g) => g.points && !g.other).slice(0, GROUP_SERIES_COLORS.length),
);
const buckets = computed<string[]>(() =>
  props.widget.breakdown
    ? (groups.value.find((g) => g.points)?.points ?? []).map((p) => p.date)
    : props.widget.points.map((p) => p.date),
);
const dates = computed(() => buckets.value.map((d) => new Date(`${d}T00:00:00Z`)));

function seriesMax(series: AnalyticsSeriesPoint[][]): number {
  if (unit.value.unit === 'percent') return 100;
  return Math.max(1, ...series.flat().map((p) => p.value ?? 0));
}

const yMax = computed(() =>
  seriesMax(props.widget.breakdown ? lineGroups.value.map((g) => g.points!) : [props.widget.points]),
);

function pathOf(series: AnalyticsSeriesPoint[], plotWidth: number, yScale: (v: number) => number): string {
  const { centerOf } = barGeometry(series.length, plotWidth);
  let d = '';
  let pen = false;
  series.forEach((p, i) => {
    if (p.value === null) {
      pen = false;
      return;
    }
    d += `${pen ? 'L' : 'M'}${centerOf(i)},${yScale(p.value)}`;
    pen = true;
  });
  return d;
}

function xTicks(plotWidth: number) {
  const { centerOf } = barGeometry(buckets.value.length, plotWidth);
  return dayTickIndices(dates.value, Math.max(2, Math.floor(plotWidth / 80))).map((i) => ({
    x: centerOf(i),
    label: formatTickDate(dates.value[i] as Date),
  }));
}

function bars(plotWidth: number, plotHeight: number, yScale: (v: number) => number) {
  const { barWidth, centerOf } = barGeometry(props.widget.points.length, plotWidth);
  return props.widget.points.flatMap((p, i) =>
    p.value === null
      ? []
      : [
          {
            x: centerOf(i) - barWidth / 2,
            y: yScale(p.value),
            width: barWidth,
            height: plotHeight - yScale(p.value),
            p,
          },
        ],
  );
}

const legend = computed(() =>
  lineGroups.value.map((g, i) => ({ color: GROUP_SERIES_COLORS[i]!, label: g.label, key: g.key })),
);

/** Horizontal bars per group, sized against the largest value. */
const groupMax = computed(() =>
  unit.value.unit === 'percent' ? 100 : Math.max(1, ...groups.value.map((g) => Math.abs(g.value.value ?? 0))),
);

function barWidthPct(value: AnalyticsMetricValue): string {
  return `${Math.max(0, Math.min(100, (Math.abs(value.value ?? 0) / groupMax.value) * 100))}%`;
}

/** A heatmap cell: the pass-rate scale for a percentage, the bar color at the value's share of the largest otherwise. */
const heatMax = computed(() =>
  Math.max(
    1,
    ...(props.widget.breakdown ? groups.value.flatMap((g) => g.points ?? []) : props.widget.points).map(
      (p) => p.value ?? 0,
    ),
  ),
);

function cellStyle(value: number | null): Record<string, string> {
  if (value === null) return {};
  if (unit.value.unit === 'percent') return { backgroundColor: passRateStep(value).color };
  const share = Math.max(0.08, Math.min(1, value / heatMax.value));
  return { backgroundColor: `color-mix(in srgb, ${BAR_COLOR} ${Math.round(share * 100)}%, transparent)` };
}

const heatRows = computed(() =>
  props.widget.breakdown
    ? groups.value.filter((g) => g.points).map((g) => ({ key: g.key, label: g.label, points: g.points! }))
    : [{ key: 'all', label: unit.value.label, points: props.widget.points }],
);

const hasSeriesData = computed(() => props.widget.points.some((p) => p.value !== null));
</script>

<template>
  <div class="w-full" data-shot="analytics-metric-display">
    <!-- Grouped -->
    <template v-if="widget.breakdown">
      <EmptyState v-if="groups.length === 0" text="Nothing to break down in this period." />

      <ul
        v-else-if="widget.display === 'bar'"
        class="space-y-2"
        :aria-label="`${unit.label} by ${widget.breakdown.label}`"
      >
        <li v-for="g in groups" :key="g.key" class="space-y-0.5">
          <div class="flex items-baseline justify-between gap-2 text-sm">
            <span class="min-w-0 truncate text-highlighted" :title="g.label">{{ g.label }}</span>
            <span class="shrink-0 tabular-nums" :class="metricValueClass(g.value)">
              {{ formatMetric(g.value, f) }}
              <span v-if="f.delta(g.value)" class="text-xs" :class="metricTrendClass(g.value.trend)">
                {{ f.delta(g.value) }}
              </span>
            </span>
          </div>
          <div class="h-2 rounded bg-elevated">
            <div class="h-2 rounded" :style="{ width: barWidthPct(g.value), backgroundColor: BAR_COLOR }" />
          </div>
        </li>
      </ul>

      <TableScroller v-else-if="widget.display === 'table'" min-width="20rem">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-xs text-muted text-left">
              <th class="py-1 pr-2 font-medium">{{ widget.breakdown.label }}</th>
              <th class="py-1 px-2 font-medium text-right">{{ unit.label }}</th>
              <th class="py-1 pl-2 font-medium text-right">Change</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="g in groups" :key="g.key">
              <td class="py-1 pr-2 text-highlighted break-words">{{ g.label }}</td>
              <td class="py-1 px-2 text-right tabular-nums" :class="metricValueClass(g.value)">
                {{ formatMetric(g.value, f) }}
              </td>
              <td class="py-1 pl-2 text-right tabular-nums text-xs" :class="metricTrendClass(g.value.trend)">
                {{ f.delta(g.value) ?? '—' }}
              </td>
            </tr>
          </tbody>
        </table>
      </TableScroller>

      <div v-else-if="widget.display === 'line'" class="space-y-2">
        <ChartFrame v-slot="{ plotWidth, plotHeight, yScale }" :height="220" :y-max="yMax" :y-format="yFormat">
          <path
            v-for="(g, i) in lineGroups"
            :key="g.key"
            :d="pathOf(g.points!, plotWidth, yScale)"
            fill="none"
            :stroke="GROUP_SERIES_COLORS[i]"
            stroke-width="2"
          />
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
        </ChartFrame>
        <ul class="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted">
          <li v-for="item in legend" :key="item.key" class="flex items-center gap-1">
            <span class="inline-block size-2 rounded-full" :style="{ backgroundColor: item.color }" />
            {{ item.label }}
          </li>
        </ul>
      </div>

      <TableScroller v-else min-width="24rem">
        <div class="space-y-1">
          <div v-for="row in heatRows" :key="row.key" class="flex items-center gap-2">
            <span class="w-28 shrink-0 truncate text-xs text-muted" :title="row.label">{{ row.label }}</span>
            <div class="flex flex-1 gap-px">
              <div
                v-for="p in row.points"
                :key="p.date"
                class="h-5 flex-1 rounded-sm bg-elevated"
                :style="cellStyle(p.value)"
                :title="`${row.label} · ${f.date(p.date)}: ${valueText(p.value)}`"
              />
            </div>
          </div>
        </div>
      </TableScroller>
    </template>

    <!-- Over time -->
    <template v-else>
      <EmptyState v-if="!hasSeriesData" text="No runs in this period." />

      <ChartFrame
        v-else-if="widget.display === 'bar'"
        v-slot="{ plotWidth, plotHeight, yScale }"
        :height="220"
        :y-max="yMax"
        :y-format="yFormat"
      >
        <rect
          v-for="bar in bars(plotWidth, plotHeight, yScale)"
          :key="bar.p.date"
          :x="bar.x"
          :y="bar.y"
          :width="bar.width"
          :height="bar.height"
          :fill="BAR_COLOR"
          rx="2"
        >
          <title>{{ f.date(bar.p.date) }}: {{ valueText(bar.p.value) }}</title>
        </rect>
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
      </ChartFrame>

      <TableScroller v-else-if="widget.display === 'table'" min-width="16rem">
        <table class="w-full text-sm">
          <thead>
            <tr class="text-xs text-muted text-left">
              <th class="py-1 pr-2 font-medium">Date</th>
              <th class="py-1 pl-2 font-medium text-right">{{ unit.label }}</th>
            </tr>
          </thead>
          <tbody class="divide-y divide-default">
            <tr v-for="p in widget.points" :key="p.date">
              <td class="py-1 pr-2 text-highlighted">{{ f.date(p.date) }}</td>
              <td class="py-1 pl-2 text-right tabular-nums">{{ valueText(p.value) }}</td>
            </tr>
          </tbody>
        </table>
      </TableScroller>

      <div v-else class="flex gap-px">
        <div
          v-for="p in widget.points"
          :key="p.date"
          class="h-8 flex-1 rounded-sm bg-elevated"
          :style="cellStyle(p.value)"
          :title="`${f.date(p.date)}: ${valueText(p.value)}`"
        />
      </div>
    </template>
  </div>
</template>
