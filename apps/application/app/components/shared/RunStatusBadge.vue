<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui';

defineProps<{
  status: string;
  size?: BadgeProps['size'];
}>();
</script>

<template>
  <UBadge :color="getStatusColor(status)" :size="size" variant="subtle" class="capitalize gap-1 items-center">
    <UIcon
      v-if="status === 'running' || status === 'initializing' || status === 'finalizing'"
      name="i-lucide-loader-circle"
      class="size-3 animate-spin shrink-0"
    />
    {{ formatStatusLabel(status) }}
  </UBadge>
</template>
