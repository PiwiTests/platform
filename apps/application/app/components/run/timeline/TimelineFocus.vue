<script setup lang="ts">
/**
 * The hovered bar, lifted above a translucent wash over the rest of the
 * timeline. A hover changes this one overlay and one copied bar, so moving
 * across hundreds of bars restyles nothing else. The copy ignores the pointer:
 * the bar underneath stays the hover target. Empty stretches of a lane never
 * take the focus.
 */
import { computed } from 'vue';
import { isGapKind, type TimelineItem } from '~/composables/useTimelineModel';
import { TIMELINE_LAYOUT } from '~/utils/timeline';

const props = defineProps<{
  /** The hover state the timeline shares with its tooltip. */
  state: { item: TimelineItem | null };
  contentWidth: number;
  contentHeight: number;
  getBarX: (item: TimelineItem) => number;
  getBarTop: (item: TimelineItem) => number;
  getBarWidth: (item: TimelineItem) => number;
  lockColors: (item: TimelineItem) => string[];
  expandable: (item: TimelineItem) => boolean;
  /** A test's hook sections, lifted with it. */
  hooks: (item: TimelineItem) => TimelineItem[];
  hookGeometry: (item: TimelineItem) => { x: number; width: number };
}>();

const { labelWidth, axisHeight } = TIMELINE_LAYOUT;

const focus = computed(() => {
  const item = props.state.item;
  return item && !isGapKind(item.kind) ? item : null;
});
</script>

<template>
  <g v-if="focus" class="pointer-events-none" data-timeline-focus>
    <rect
      :x="labelWidth"
      :y="axisHeight"
      :width="Math.max(0, contentWidth - labelWidth)"
      :height="Math.max(0, contentHeight - axisHeight)"
      fill-opacity="0.6"
      :style="{ fill: 'var(--ui-bg-canvas)' }"
    />
    <TimelineBar
      :item="focus"
      :x="getBarX(focus)"
      :y="getBarTop(focus)"
      :width="getBarWidth(focus)"
      :lock-colors="lockColors(focus)"
      :expandable="expandable(focus)"
      :hooks="hooks(focus)"
      :hook-geometry="hookGeometry"
    />
  </g>
</template>
