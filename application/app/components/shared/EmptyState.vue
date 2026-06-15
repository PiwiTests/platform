<script setup lang="ts">
withDefaults(
  defineProps<{
    text: string;
    /** Optional lucide icon shown above the text. */
    icon?: string;
    /** Apply default vertical padding (`py-8`). Set false when the parent controls layout. */
    padded?: boolean;
  }>(),
  { padded: true },
);
</script>

<template>
  <div class="flex flex-col items-center justify-center gap-2 text-center text-gray-500" :class="padded && 'py-8'">
    <UIcon v-if="icon" :name="icon" class="size-6 opacity-60" />
    <p class="text-sm">{{ text }}</p>
    <slot />
  </div>
</template>
