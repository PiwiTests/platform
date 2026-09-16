<script setup lang="ts">
import type { MarkerInfo } from '~~/types/api';
import { getMarkerCategory } from '#shared/marker-categories';

/**
 * Vertical timeline-marker lines for an SVG trend chart: a dashed line with a
 * clickable flag handle per marker, plus the shared marker tooltip. Rendered
 * inside a `ChartFrame` slot. `xOf` maps a marker's timestamp to a plot-space
 * x position; null hides the marker (outside the plotted range).
 */
const props = defineProps<{
  markers: MarkerInfo[];
  xOf: (occurredAt: string | Date) => number | null;
  plotHeight: number;
}>();

const emit = defineEmits<{ 'marker-click': [id: number] }>();

const positioned = computed(() =>
  props.markers
    .map((marker) => ({ marker, x: props.xOf(marker.occurredAt), color: getMarkerCategory(marker.category).hex }))
    .filter((entry): entry is { marker: MarkerInfo; x: number; color: string } => entry.x != null),
);

const { data: hovered, pos, show, move, hide } = useChartTooltip<MarkerInfo>();
</script>

<template>
  <g>
    <g v-for="{ marker, x, color } in positioned" :key="marker.id">
      <line
        :x1="x"
        :x2="x"
        :y1="0"
        :y2="plotHeight"
        :stroke="color"
        :stroke-width="hovered?.id === marker.id ? 2 : 1.5"
        stroke-dasharray="4 3"
        :opacity="hovered?.id === marker.id ? 1 : 0.75"
        class="pointer-events-none"
      />
      <circle
        :cx="x"
        :cy="0"
        :r="hovered?.id === marker.id ? 6 : 4"
        :fill="color"
        stroke="#fff"
        stroke-width="1.5"
        class="cursor-pointer"
        @click="emit('marker-click', marker.id)"
        @mouseenter="show($event, marker)"
        @mousemove="move($event)"
        @mouseleave="hide()"
      />
    </g>
  </g>
  <Teleport to="body">
    <ChartMarkerTooltip :marker="hovered" :pos="pos" />
  </Teleport>
</template>
