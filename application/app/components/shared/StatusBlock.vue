<script setup lang="ts">
defineProps<{
  status: string;
  size?: 'sm' | 'md';
}>();

function iconName(status: string): string {
  if (status === 'passed') return 'i-lucide-check-circle-2';
  if (status === 'failed' || status === 'timedout') return 'i-lucide-x-circle';
  if (status === 'running' || status === 'initialising' || status === 'finalizing') return 'i-lucide-loader-circle';
  return 'i-lucide-minus-circle';
}

function isSpinning(status: string): boolean {
  return status === 'running' || status === 'initialising' || status === 'finalizing';
}
</script>

<template>
  <div class="flex items-center gap-2.5">
    <div
      class="shrink-0 rounded-lg flex items-center justify-center"
      :class="[
        size === 'sm' ? 'size-7' : 'size-8',
        {
          'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400': status === 'passed',
          'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400': status === 'failed' || status === 'timedout',
          'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400': status === 'cancelled' || status === 'skipped',
          'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400':
            status === 'running' || status === 'initialising' || status === 'finalizing',
        },
      ]"
    >
      <UIcon :name="iconName(status)" :class="[size === 'sm' ? 'size-3.5' : 'size-4.5', { 'animate-spin': isSpinning(status) }]" />
    </div>
    <UBadge :color="getStatusColor(status)" class="capitalize gap-1 items-center">
      <UIcon
        v-if="isSpinning(status)"
        name="i-lucide-loader-circle"
        class="size-3 animate-spin shrink-0"
      />
      {{ status }}
    </UBadge>
  </div>
</template>
