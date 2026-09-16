<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineItem } from '~/composables/useTimelineModel';
import {
  TIMELINE_LAYOUT,
  TIMELINE_WAIT_COLORS,
  timelineStatusHex,
  timelineHookFill,
  timelineHookStroke,
  timelineStepColor,
  formatTimelineTime,
} from '~/utils/timeline';

const props = defineProps<{
  item: TimelineItem;
  x: number;
  y: number;
  width: number;
  /** Colors of the locks this bar's execution held, in the run's lock order. */
  lockColors?: string[];
  /** Whether this test row can be expanded into its step waterfall (test bars only). */
  expandable?: boolean;
}>();

const emit = defineEmits<{
  select: [id: number];
  toggleExpand: [id: number];
  hover: [item: TimelineItem, event: MouseEvent];
  move: [event: MouseEvent];
  leave: [];
}>();

const { barHeight, stepBarHeight } = TIMELINE_LAYOUT;

/** Setup steps render like hooks; they just aren't tied to a test case. */
const isHookLike = computed(() => ['setup', 'hook', 'fixture'].includes(props.item.kind));

/** Every bar with an owning test case clicks through to it (suite setup has none). */
const clickable = computed(() => props.item.testCaseId != null);
const cursorClass = computed(() => (clickable.value ? 'cursor-pointer' : 'cursor-default'));

// A step bar is shorter than a test bar and centered in its lane.
const stepY = computed(() => props.y + (barHeight - stepBarHeight) / 2);
const stepFill = computed(() => timelineStepColor(props.item.category ?? 'other', props.item.status === 'failed'));

function onClick(): void {
  if (props.item.testCaseId != null) emit('select', props.item.testCaseId);
}

// Clicking a test bar expands or collapses its step waterfall; when the row
// can't be expanded (a live run, no execution id) it falls back to selecting.
function onTestClick(): void {
  if (props.item.testCaseId == null) return;
  if (props.expandable) emit('toggleExpand', props.item.testCaseId);
  else emit('select', props.item.testCaseId);
}
</script>

<template>
  <g
    class="timeline-bar-group"
    @mouseenter="emit('hover', item, $event)"
    @mousemove="emit('move', $event)"
    @mouseleave="emit('leave')"
  >
    <template v-if="item.kind === 'step'">
      <rect
        :x="x"
        :y="stepY"
        :width="width"
        :height="stepBarHeight"
        :rx="2"
        :ry="2"
        :fill="stepFill"
        class="timeline-bar-shape transition-opacity duration-100 cursor-pointer opacity-90"
        @click="onClick"
      />
      <text
        v-if="width > 34"
        :x="x + 4"
        :y="stepY + stepBarHeight / 2 + 3.5"
        class="fill-white text-[9px] font-medium pointer-events-none"
      >
        {{ item.title }}
      </text>
    </template>
    <template v-else-if="isHookLike">
      <rect
        :x="x"
        :y="y"
        :width="width"
        :height="barHeight"
        :rx="3"
        :ry="3"
        :fill="timelineHookFill(item.status)"
        :stroke="timelineHookStroke(item.status)"
        stroke-width="1"
        stroke-dasharray="3,2"
        class="timeline-bar-shape transition-opacity duration-100 opacity-80"
        :class="cursorClass"
        @click="onClick"
      />
      <text
        v-if="width > 60"
        :x="x + 4"
        :y="y + barHeight / 2 + 4"
        class="fill-gray-600 dark:fill-gray-300 text-[9px] font-medium pointer-events-none"
      >
        {{ item.title }}
      </text>
    </template>
    <template v-else-if="item.kind === 'wait'">
      <!-- slightly taller bar, offset into the row gap above/below -->
      <rect
        :x="x"
        :y="y - 3"
        :width="width"
        :height="barHeight + 6"
        :rx="2"
        :ry="2"
        :fill="TIMELINE_WAIT_COLORS.fill"
        fill-opacity="0.28"
        :stroke="TIMELINE_WAIT_COLORS.stroke"
        stroke-width="1.5"
        class="timeline-bar-shape transition-opacity duration-100 opacity-90"
        :class="cursorClass"
        @click="onClick"
      />
      <line
        v-if="width > 4"
        :x1="x + 1"
        :y1="y - 3"
        :x2="x + width - 1"
        :y2="y + barHeight + 3"
        :stroke="TIMELINE_WAIT_COLORS.stroke"
        stroke-width="1"
        stroke-opacity="0.25"
        class="pointer-events-none"
      />
      <line
        v-if="width > 4"
        :x1="x + width - 1"
        :y1="y - 3"
        :x2="x + 1"
        :y2="y + barHeight + 3"
        :stroke="TIMELINE_WAIT_COLORS.stroke"
        stroke-width="1"
        stroke-opacity="0.25"
        class="pointer-events-none"
      />
      <text
        v-if="width > 50"
        :x="x + 4"
        :y="y + barHeight / 2 + 4"
        class="fill-yellow-800 dark:fill-yellow-200 text-[9px] font-bold pointer-events-none"
      >
        wasted {{ formatTimelineTime(item.duration) }}
      </text>
    </template>
    <template v-else-if="item.status === 'running'">
      <circle
        :cx="x + 6"
        :cy="y + barHeight / 2"
        r="3"
        fill="#2563eb"
        filter="url(#glow)"
        class="timeline-bar-shape transition-opacity duration-100 cursor-pointer opacity-90"
        @click="onClick"
      />
      <circle
        :cx="x + 6"
        :cy="y + barHeight / 2"
        r="5"
        fill="none"
        stroke="#2563eb"
        stroke-width="1.5"
        stroke-opacity="0.4"
        filter="url(#glow)"
        class="timeline-bar-shape transition-opacity duration-100 cursor-pointer opacity-90"
        @click="onClick"
      />
    </template>
    <template v-else>
      <rect
        :x="x"
        :y="y"
        :width="width"
        :height="barHeight"
        :rx="3"
        :ry="3"
        :fill="timelineStatusHex(item.status)"
        class="timeline-bar-shape transition-opacity duration-100 cursor-pointer opacity-90"
        @click="onTestClick"
      />
      <!-- Lock brackets: a thin colored strip along the top edge per held lock. -->
      <rect
        v-for="(color, i) in lockColors ?? []"
        :key="`lock${i}`"
        :x="x"
        :y="y + i * 3"
        :width="width"
        :height="2.5"
        :fill="color"
        class="pointer-events-none"
      />
      <!-- Expand affordance: a chevron that turns down when the step waterfall is open. -->
      <text
        v-if="expandable && width > 22"
        :x="x + 4"
        :y="y + barHeight / 2 + 3.5"
        class="fill-white text-[10px] pointer-events-none select-none"
      >
        {{ item.expanded ? '▾' : '▸' }}
      </text>
      <text
        v-if="width > 40"
        :x="expandable ? x + 16 : x + 4"
        :y="y + barHeight / 2 + 4"
        class="fill-white text-[10px] font-medium pointer-events-none"
      >
        {{ formatTimelineTime(item.duration) }}
      </text>
    </template>
  </g>
</template>
