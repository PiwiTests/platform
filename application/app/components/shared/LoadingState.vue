<script setup lang="ts">
withDefaults(
  defineProps<{
    text?: string;
    /** Apply default vertical padding (`py-8`). Set false when the parent controls layout. */
    padded?: boolean;
  }>(),
  { text: 'Loading…', padded: true },
);
</script>

<template>
  <div class="flex items-center justify-center gap-2 text-gray-400" :class="padded && 'py-8'">
    <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
    <span class="text-sm">{{ text }}</span>
  </div>
</template>
