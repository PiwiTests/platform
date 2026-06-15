<script setup lang="ts">
defineProps<{
  items: { color: string; label: string }[];
  /** Compact variant (smaller dots/text) used by inline charts like the history sparkline. */
  dense?: boolean;
}>();
</script>

<template>
  <div
    class="flex items-center justify-center flex-wrap"
    :class="dense ? 'gap-4 mt-2 text-xs text-gray-500' : 'gap-6 mt-4 text-sm'"
  >
    <span v-for="item in items" :key="item.label" class="flex items-center" :class="dense ? 'gap-1' : 'gap-2'">
      <span
        class="rounded-full inline-block"
        :class="dense ? 'w-2.5 h-2.5' : 'w-3 h-3'"
        :style="{ backgroundColor: item.color }"
      />
      {{ item.label }}
    </span>
  </div>
</template>
