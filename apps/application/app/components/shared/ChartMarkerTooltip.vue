<script setup lang="ts">
import type { MarkerInfo } from '~~/types/api';

defineProps<{
  marker: MarkerInfo | null;
  pos: { x: number; y: number };
}>();
</script>

<template>
  <div
    v-if="marker"
    class="fixed z-50 pointer-events-none bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 max-w-[260px]"
    :style="{ left: `${pos.x}px`, top: `${pos.y}px` }"
  >
    <div class="p-2 text-sm text-gray-900 dark:text-gray-100 space-y-1">
      <MarkerBadge :marker="marker" />
      <div class="text-xs text-muted">
        {{
          new Date(marker.occurredAt).toLocaleDateString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
          })
        }}
      </div>
      <div v-if="marker.environment" class="text-xs">
        <EnvironmentBadge :name="marker.environment" />
      </div>
      <p v-if="marker.description" class="text-xs text-muted">{{ marker.description }}</p>
    </div>
  </div>
</template>
