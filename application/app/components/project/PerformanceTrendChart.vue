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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const xyContainerRef = ref<any>(null);
const tooltipData = ref<DataPoint | null>(null);
const tooltipPos = ref({ x: 0, y: 0 });

const yAccessors: {
  fn: (d: DataPoint) => number | null | undefined;
  color: string;
}[] = [
  { fn: (d: DataPoint) => d.duration, color: lineColors[0] },
  { fn: (d: DataPoint) => d.avgTestDuration, color: lineColors[1] },
  { fn: (d: DataPoint) => d.p90TestDuration, color: lineColors[2] },
];

const NS = 'http://www.w3.org/2000/svg';

function addMarkers(
  svgNode: SVGSVGElement,
  margin: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  },
) {
  svgNode.querySelectorAll('.chart-marker').forEach((el) => el.remove());

  const container = xyContainerRef.value?.component;
  if (!container || !chartData.value.length) {
    return;
  }

  const comp = container.components?.[0];
  const xScale = comp?.xScale;
  const yScale = comp?.yScale;
  if (!xScale || !yScale) {
    return;
  }

  const group = document.createElementNS(NS, 'g');
  group.setAttribute('class', 'chart-marker');
  group.setAttribute('transform', `translate(${margin.left},${margin.top})`);
  svgNode.appendChild(group);

  for (const point of chartData.value) {
    for (const { fn, color } of yAccessors) {
      const yVal = fn(point);
      if (yVal == null) {
        continue;
      }
      const cx = xScale(point.date);
      const cy = yScale(yVal);
      const circle = document.createElementNS(NS, 'circle');
      circle.setAttribute('cx', String(cx));
      circle.setAttribute('cy', String(cy));
      circle.setAttribute('r', '4.5');
      circle.setAttribute('fill', color);
      circle.setAttribute('stroke', '#fff');
      circle.setAttribute('stroke-width', '1.5');
      circle.setAttribute('cursor', 'pointer');
      circle.addEventListener('click', () => navigateTo(`/test-runs/${point.id}`));
      circle.addEventListener('mouseenter', () => {
        circle.setAttribute('r', '7');
        circle.setAttribute('stroke-width', '2.5');
        tooltipData.value = point;
      });
      circle.addEventListener('mousemove', (e: MouseEvent) => {
        const tw = 260;
        const ox = 12;
        const x = e.clientX + ox + tw > window.innerWidth - 8 ? e.clientX - tw - ox : e.clientX + ox;
        tooltipPos.value = { x, y: e.clientY - 12 };
      });
      circle.addEventListener('mouseleave', () => {
        circle.setAttribute('r', '4.5');
        circle.setAttribute('stroke-width', '1.5');
        tooltipData.value = null;
      });
      group.appendChild(circle);
    }
  }
}

function onChartRender(
  svgNode: SVGSVGElement,
  margin: {
    top: number;
    bottom: number;
    left: number;
    right: number;
  },
) {
  addMarkers(svgNode, margin);
}
</script>

<template>
  <div class="w-full relative">
    <div v-if="chartData.length > 0">
      <VisXYContainer
        ref="xyContainerRef"
        :data="chartData"
        :height="height"
        :padding="{ top: 10, right: 10, bottom: 0, left: 0 }"
        :on-render-complete="onChartRender"
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

    <div v-else class="text-center py-12 text-gray-500">
      <p>No performance data available to display chart</p>
    </div>

    <div class="flex items-center justify-center gap-6 mt-4 text-sm">
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-blue-500" />
        <span>Total Duration</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-green-500" />
        <span>Avg Test Duration</span>
      </div>
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-orange-500" />
        <span>P90 Test Duration</span>
      </div>
    </div>
  </div>
</template>
