<script setup lang="ts">
import type { TimelineItem } from '~/composables/useTimelineModel';
import { timelineStatusHex, timelineHookFill, timelineHookStroke, formatTimelineTime } from '~/utils/timeline';

defineProps<{
  item: TimelineItem | null;
  pos: { x: number; y: number };
}>();
</script>

<template>
  <Teleport to="body">
    <div
      v-if="item"
      class="fixed z-[9999] pointer-events-none rounded-lg border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-xs shadow-lg"
      :style="{ left: pos.x + 12 + 'px', top: pos.y - 10 + 'px' }"
    >
      <div class="flex items-center gap-2 mb-1">
        <span
          v-if="!item.isHook && !item.isWait"
          class="inline-block size-2.5 rounded-full shrink-0"
          :style="{ backgroundColor: timelineStatusHex(item.status) }"
        />
        <span
          v-else
          class="inline-block size-2.5 rounded-full shrink-0 border border-dashed"
          :style="{
            backgroundColor: item.isWait ? '#f59e0b66' : timelineHookFill(item.status, item.isHook),
            borderColor: item.isWait ? '#f59e0b' : timelineHookStroke(item.status, item.isHook),
          }"
        />
        <span class="font-medium text-gray-900 dark:text-white max-w-64 truncate">
          <template v-if="item.isHook">
            <span class="uppercase text-[10px] tracking-wider text-gray-500 mr-1">{{ item.category }}</span>
            {{ item.title }}
          </template>
          <template v-else-if="item.isWait">
            <span class="uppercase text-[10px] tracking-wider text-amber-500 mr-1">{{ item.category }}</span>
            {{ item.title }}
          </template>
          <template v-else>
            {{ item.title }}
          </template>
        </span>
      </div>
      <div class="flex items-center gap-3 text-gray-500">
        <span class="capitalize">{{ item.status }}</span>
        <span>{{ formatTimelineTime(item.duration) }}</span>
        <span>Worker {{ item.workerIndex }}</span>
        <span v-if="item.isHook && item.parentTitle" class="italic truncate max-w-48">
          for {{ item.parentTitle }}
        </span>
      </div>
    </div>
  </Teleport>
</template>
