<script setup lang="ts">
import type { ShardGroup } from '~/composables/useTimelineModel';
import { TIMELINE_LAYOUT } from '~/utils/timeline';

defineProps<{
  workerRows: Array<{ shardIndex: number | null; workerIndex: number }>;
  shardGroups: ShardGroup[];
  tickMarks: Array<{ ms: number; x: number; label: string }>;
  contentWidth: number;
  shardTotal?: number | null;
}>();

const { barHeight, rowGap, axisHeight, rowHeight } = TIMELINE_LAYOUT;
</script>

<template>
  <g>
    <rect
      v-for="(row, i) in workerRows"
      :key="'bg-' + i"
      :x="0"
      :y="i * rowHeight + axisHeight"
      :width="contentWidth"
      :height="rowHeight"
      :fill="i % 2 === 0 ? 'transparent' : 'rgba(0,0,0,0.03)'"
      class="dark:fill-white/[0.03]"
    />

    <!-- Shard group separator lines -->
    <line
      v-for="sg in shardGroups.slice(1)"
      :key="'shard-sep-' + sg.rowRange[0]"
      :x1="0"
      :y1="sg.rowRange[0] * rowHeight + axisHeight - rowGap / 2"
      :x2="contentWidth"
      :y2="sg.rowRange[0] * rowHeight + axisHeight - rowGap / 2"
      stroke="currentColor"
      stroke-dasharray="4,3"
      class="stroke-gray-400 dark:stroke-gray-500"
    />

    <line
      :x1="TIMELINE_LAYOUT.labelWidth"
      :y1="axisHeight"
      :x2="contentWidth"
      :y2="axisHeight"
      stroke="currentColor"
      class="stroke-gray-300 dark:stroke-gray-600"
    />

    <g v-for="tick in tickMarks" :key="tick.ms">
      <line
        :x1="tick.x"
        :y1="axisHeight - 4"
        :x2="tick.x"
        :y2="axisHeight"
        stroke="currentColor"
        class="stroke-gray-300 dark:stroke-gray-600"
      />
      <text :x="tick.x" :y="axisHeight - 8" text-anchor="middle" class="fill-gray-400 text-[10px]">
        {{ tick.label }}
      </text>
    </g>

    <text
      v-for="(row, i) in workerRows"
      :key="'label-' + i"
      :x="6"
      :y="i * rowHeight + axisHeight + barHeight / 2 + 4"
      class="fill-gray-500 text-[11px] font-medium"
    >
      {{
        row.shardIndex != null && shardTotal && shardTotal > 1
          ? `S${row.shardIndex} W${row.workerIndex}`
          : `Worker ${row.workerIndex}`
      }}
    </text>
  </g>
</template>
