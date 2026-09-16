<script setup lang="ts">
import { computed } from 'vue';
import type { TimelineItem } from '~/composables/useTimelineModel';
import {
  TIMELINE_WAIT_COLORS,
  timelineStatusHex,
  timelineHookFill,
  timelineHookStroke,
  timelineStepColor,
  formatTimelineTime,
} from '~/utils/timeline';

const props = defineProps<{
  item: TimelineItem | null;
  pos: { x: number; y: number };
  /** Lock name → color, so the tooltip swatches match the brackets. */
  lockColorMap?: Map<string, string>;
}>();

const swatchStyle = computed(() => {
  const item = props.item;
  if (!item) return {};
  if (item.kind === 'test') return { backgroundColor: timelineStatusHex(item.status) };
  if (item.kind === 'step')
    return { backgroundColor: timelineStepColor(item.category ?? 'other', item.status === 'failed') };
  if (item.kind === 'wait') {
    return { backgroundColor: TIMELINE_WAIT_COLORS.swatch + '66', borderColor: TIMELINE_WAIT_COLORS.swatch };
  }
  return { backgroundColor: timelineHookFill(item.status), borderColor: timelineHookStroke(item.status) };
});

// Anchor right/bottom of the cursor by default, flipping near the viewport
// edges so the tooltip never overflows off-screen.
const TOOLTIP_MAX_WIDTH = 340;
const positionStyle = computed(() => {
  const { x, y } = props.pos;
  if (typeof window === 'undefined') return { left: `${x + 12}px`, top: `${y - 10}px` };
  const flipX = x + 12 + TOOLTIP_MAX_WIDTH > window.innerWidth;
  const flipY = y + 90 > window.innerHeight;
  return {
    left: flipX ? undefined : `${x + 12}px`,
    right: flipX ? `${window.innerWidth - x + 12}px` : undefined,
    top: flipY ? undefined : `${y - 10}px`,
    bottom: flipY ? `${window.innerHeight - y + 10}px` : undefined,
  };
});
</script>

<template>
  <Teleport to="body">
    <div
      v-if="item"
      class="fixed z-[9999] pointer-events-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs shadow-lg"
      :style="positionStyle"
    >
      <div class="flex items-center gap-2 mb-1">
        <span
          class="inline-block size-2.5 rounded-full shrink-0"
          :class="{ 'border border-dashed': item.kind !== 'test' && item.kind !== 'step' }"
          :style="swatchStyle"
        />
        <span class="font-medium text-gray-900 dark:text-white max-w-64 truncate">
          <span
            v-if="item.kind !== 'test'"
            class="uppercase text-[10px] tracking-wider mr-1"
            :class="item.kind === 'wait' ? 'text-amber-500' : 'text-gray-500'"
          >
            {{ item.kind === 'step' ? (item.category ?? 'step') : item.kind }}
          </span>
          {{ item.title }}
        </span>
      </div>
      <div v-if="item.subtitle" class="mb-1 font-mono text-[11px] text-gray-400 truncate max-w-72">
        {{ item.subtitle }}
      </div>
      <div class="flex items-center gap-3 text-gray-500">
        <span class="capitalize">{{ formatStatusLabel(item.status) }}</span>
        <span>{{ formatTimelineTime(item.duration) }}</span>
        <span>Worker {{ item.workerIndex }}</span>
        <span v-if="item.parentTitle" class="italic truncate max-w-48"> for {{ item.parentTitle }} </span>
      </div>
      <div v-if="item.error" class="mt-1 text-red-500 truncate max-w-72">{{ item.error }}</div>
      <div v-if="item.locks?.length" class="flex items-center gap-2 flex-wrap mt-1 text-gray-500">
        <UIcon name="i-lucide-lock" class="size-3 shrink-0" />
        <span v-for="lock in item.locks" :key="lock" class="inline-flex items-center gap-1">
          <span
            class="inline-block size-2 rounded-sm shrink-0"
            :style="{ backgroundColor: lockColorMap?.get(lock) ?? '#a1a1aa' }"
          />
          {{ lock }}
        </span>
      </div>
    </div>
  </Teleport>
</template>
