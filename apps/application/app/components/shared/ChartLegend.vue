<script setup lang="ts">
/**
 * Color/label key for a chart. Rendered by `ChartCard` from its `legend` prop,
 * so it sits in the card header rather than under the plot.
 */
defineProps<{
  items: readonly { color: string; label: string }[];
}>();
</script>

<template>
  <div class="flex items-center flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 dark:text-gray-400">
    <span v-for="item in items" :key="item.label" class="flex items-center gap-1">
      <span class="rounded-full inline-block w-2.5 h-2.5" :style="{ backgroundColor: item.color }" />
      {{ item.label }}
    </span>
  </div>
</template>
