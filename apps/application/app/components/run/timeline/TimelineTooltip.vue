<script setup lang="ts">
import { computed } from 'vue';
import { isHookKind, type TimelineItem } from '~/composables/useTimelineModel';
import {
  TIMELINE_WAIT_COLORS,
  timelineStatusColor,
  timelineHookColors,
  timelineStepColor,
  formatTimelineTime,
} from '~/utils/timeline';
import { stepHookName } from '#shared/step-tree';

const props = defineProps<{
  item: TimelineItem | null;
  pos: { x: number; y: number };
  /** Lock name → color, so the tooltip swatches match the brackets. */
  lockColorMap?: Map<string, string>;
}>();

const swatchStyle = computed(() => {
  const item = props.item;
  if (!item) return {};
  if (item.kind === 'test') return { backgroundColor: timelineStatusColor(item.status, item.retries) };
  if (item.kind === 'step')
    return { backgroundColor: timelineStepColor(item.category ?? 'other', item.status === 'failed') };
  if (item.kind === 'wait') {
    return { backgroundColor: TIMELINE_WAIT_COLORS.swatch + '66', borderColor: TIMELINE_WAIT_COLORS.swatch };
  }
  const hook = timelineHookColors(item.status);
  return { backgroundColor: hook.fill, opacity: Math.max(hook.opacity, 0.5) };
});

/** The small uppercase label before the title: a hook section's side, else the bar's kind. */
const kindLabel = computed(() => {
  const item = props.item;
  if (!item) return '';
  if (item.kind === 'step') return item.category ?? 'step';
  return item.section ?? item.kind;
});

/** A hook section's hooks and fixtures by short name (`beforeAll`, `fixture "db"`). */
const hookRows = computed(() =>
  (props.item?.hooks ?? []).map((hook) => ({
    name: stepHookName(hook) ?? hook.title,
    duration: hook.duration,
    failed: hook.failed === true,
  })),
);

/** What clicking the bar does, for the bars whose click is not obvious. */
const clickHint = computed(() => {
  const item = props.item;
  if (!item || item.testCaseId == null || !isHookKind(item.kind)) return null;
  return 'Click to open the steps on this hook';
});

// Anchor right/bottom of the cursor by default, flipping near the viewport
// edges so the tooltip never overflows off-screen.
const TOOLTIP_MAX_WIDTH = 340;
const positionStyle = computed(() => {
  const { x, y } = props.pos;
  if (typeof window === 'undefined') return { left: `${x + 12}px`, top: `${y - 10}px` };
  const flipX = x + 12 + TOOLTIP_MAX_WIDTH > window.innerWidth;
  const flipY = y + 90 + hookRows.value.length * 16 > window.innerHeight;
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
          :class="{ 'border border-dashed': item.kind === 'wait' }"
          :style="swatchStyle"
        />
        <span class="font-medium text-gray-900 dark:text-white max-w-64 truncate">
          <span
            v-if="item.kind !== 'test'"
            class="uppercase text-[10px] tracking-wider mr-1"
            :class="item.kind === 'wait' ? 'text-amber-500' : 'text-gray-500'"
          >
            {{ kindLabel }}
          </span>
          {{ item.title }}
        </span>
      </div>
      <div v-if="item.subtitle" class="mb-1 font-mono text-[11px] text-gray-400 truncate max-w-72">
        {{ item.subtitle }}
      </div>
      <div class="flex items-center gap-3 text-gray-500">
        <span class="capitalize">{{ formatExecutionStatus(item.status, item.retries) }}</span>
        <span>{{ formatTimelineTime(item.duration) }}</span>
        <span>Worker {{ item.workerIndex }}</span>
        <span v-if="item.parentTitle" class="italic truncate max-w-48"> for {{ item.parentTitle }} </span>
      </div>
      <div v-if="item.reportedDuration != null" class="mt-1 text-gray-400 max-w-72">
        Playwright reports {{ formatTimelineTime(item.reportedDuration) }}; the rest ran in hooks it does not count
        (beforeAll, afterAll, worker fixtures).
      </div>
      <ul v-if="hookRows.length" class="mt-1.5 space-y-0.5 max-w-72" data-testid="timeline-tooltip-hooks">
        <li
          v-for="(hook, i) in hookRows"
          :key="i"
          class="flex items-center gap-2"
          :class="hook.failed ? 'text-red-500 font-medium' : 'text-gray-600 dark:text-gray-300'"
        >
          <UIcon :name="hook.failed ? 'i-lucide-x' : 'i-lucide-dot'" class="size-3 shrink-0" />
          <span class="truncate">{{ hook.name }}</span>
          <span class="ml-auto pl-2 tabular-nums text-gray-400">{{ formatTimelineTime(hook.duration) }}</span>
        </li>
      </ul>
      <div v-if="item.error" class="mt-1 text-red-500 line-clamp-2 break-words max-w-72">{{ item.error }}</div>
      <div v-if="clickHint" class="mt-1 text-[11px] text-gray-400">{{ clickHint }}</div>
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
