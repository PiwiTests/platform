<script setup lang="ts">
import { computed } from 'vue';
import { isGapKind, isHookKind, type TimelineItem } from '~/composables/useTimelineModel';
import {
  TIMELINE_LAYOUT,
  TIMELINE_WAIT_COLORS,
  timelineStatusColor,
  timelineHookColors,
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
  /** A hook section was clicked: open its test's steps on the hook. */
  inspectHook: [item: TimelineItem];
  hover: [item: TimelineItem, event: MouseEvent];
  move: [event: MouseEvent];
  leave: [];
}>();

const { barHeight, stepBarHeight, failedHookMinWidth } = TIMELINE_LAYOUT;

/** Setup steps render like hooks; they just aren't tied to a test case. */
const isHookLike = computed(() => isHookKind(props.item.kind));
/** An empty stretch of the lane: drawn faintly, and never dims the other bars on hover. */
const isGap = computed(() => isGapKind(props.item.kind));

/** Approximate width of one character of a gap's 10px label. */
const GAP_LABEL_CHAR_PX = 5.5;

/**
 * A gap's duration, centered on its dashed line when it fits (`↻ 1.1s` for a
 * new worker process, `idle 2.0s`); the line breaks around it.
 */
const gapLabel = computed<{ text: string; from: number; to: number } | null>(() => {
  if (!isGap.value) return null;
  const time = formatTimelineTime(props.item.duration);
  const text = props.item.kind === 'restart' ? `↻ ${time}` : `idle ${time}`;
  const half = (text.length * GAP_LABEL_CHAR_PX) / 2 + 4;
  if (props.width < half * 2 + 12) return null;
  const center = props.x + props.width / 2;
  return { text, from: center - half, to: center + half };
});
const hookColors = computed(() => timelineHookColors(props.item.status));
const hookWidth = computed(() =>
  props.item.status === 'failed' ? Math.max(props.width, failedHookMinWidth) : props.width,
);

/** Every bar with an owning test case clicks through to it (suite setup has none). */
const clickable = computed(() => props.item.testCaseId != null);
const cursorClass = computed(() => (clickable.value ? 'cursor-pointer' : 'cursor-default'));

// A step bar is shorter than a test bar and centered in its lane.
const stepY = computed(() => props.y + (barHeight - stepBarHeight) / 2);
const stepFill = computed(() => timelineStepColor(props.item.category ?? 'other', props.item.status === 'failed'));

function onClick(): void {
  if (props.item.testCaseId != null) emit('select', props.item.testCaseId);
}

function onHookClick(): void {
  if (props.item.testCaseId != null) emit('inspectHook', props.item);
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
    :class="isGap ? 'timeline-gap-group' : 'timeline-bar-group'"
    @mouseenter="emit('hover', item, $event)"
    @mousemove="emit('move', $event)"
    @mouseleave="emit('leave')"
  >
    <template v-if="isGap">
      <!-- A hover target over the whole stretch, a dashed midline broken around
           its duration, and for a new worker process a tick where it took over. -->
      <rect
        :x="x"
        :y="y"
        :width="Math.max(width, 6)"
        :height="barHeight"
        fill="transparent"
        data-timeline-gap
        :data-kind="item.kind"
      />
      <line
        v-for="(segment, i) in gapLabel
          ? [
              [x, gapLabel.from],
              [gapLabel.to, x + width],
            ]
          : [[x, x + width]]"
        :key="i"
        :x1="segment[0]"
        :y1="y + barHeight / 2"
        :x2="segment[1]"
        :y2="y + barHeight / 2"
        stroke="currentColor"
        stroke-dasharray="2,4"
        class="text-gray-300 dark:text-gray-600 pointer-events-none"
      />
      <text
        v-if="gapLabel"
        :x="x + width / 2"
        :y="y + barHeight / 2 + 3.5"
        text-anchor="middle"
        class="fill-gray-400 dark:fill-gray-500 text-[10px] tabular-nums pointer-events-none select-none"
      >
        {{ gapLabel.text }}
      </text>
      <template v-if="item.kind === 'restart'">
        <line
          :x1="x + width"
          :y1="y + 2"
          :x2="x + width"
          :y2="y + barHeight - 2"
          stroke="currentColor"
          stroke-width="1.5"
          class="text-gray-400 dark:text-gray-500 pointer-events-none"
        />
        <text
          v-if="!gapLabel && width > 18"
          :x="x + width / 2"
          :y="y + barHeight / 2 + 4"
          text-anchor="middle"
          class="fill-gray-400 dark:fill-gray-500 text-[11px] pointer-events-none select-none"
        >
          ↻
        </text>
      </template>
    </template>
    <template v-else-if="item.kind === 'step'">
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
      <!-- Hook time over the test's bar: a wash, hatched so it reads as not the test body. -->
      <rect
        :x="x"
        :y="y"
        :width="hookWidth"
        :height="barHeight"
        :rx="3"
        :ry="3"
        :fill="hookColors.fill"
        :fill-opacity="hookColors.opacity"
        :stroke="hookColors.stroke"
        stroke-width="1"
        class="timeline-bar-shape transition-opacity duration-100"
        :class="cursorClass"
        data-timeline-hook
        :data-status="item.status"
        @click="onHookClick"
      />
      <rect
        :x="x"
        :y="y"
        :width="hookWidth"
        :height="barHeight"
        :rx="3"
        :ry="3"
        fill="url(#timeline-hook-hatch)"
        class="timeline-bar-shape transition-opacity duration-100 pointer-events-none"
      />
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
        :style="{ fill: STATUS_PALETTE.running.color }"
        filter="url(#glow)"
        class="timeline-bar-shape transition-opacity duration-100 cursor-pointer opacity-90"
        @click="onClick"
      />
      <circle
        :cx="x + 6"
        :cy="y + barHeight / 2"
        r="5"
        fill="none"
        :style="{ stroke: STATUS_PALETTE.running.color }"
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
        :style="{ fill: timelineStatusColor(item.status, item.retries) }"
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
