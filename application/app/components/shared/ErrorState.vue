<script setup lang="ts">
withDefaults(
  defineProps<{
    text: string;
    icon?: string;
    padded?: boolean;
  }>(),
  { icon: 'i-lucide-circle-alert', padded: true },
);
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 text-center" :class="padded && 'p-4'">
    <UIcon :name="icon" class="size-5 text-red-400" />
    <p class="text-sm text-red-500">{{ text }}</p>
    <!-- Put a retry button or extra hint here -->
    <slot name="action" />
  </div>
</template>
