<script setup lang="ts">
defineProps<{
  status: string;
}>();
</script>

<template>
  <UBadge :color="getStatusColor(status)" class="capitalize gap-1 items-center">
    <UIcon
      v-if="status === 'running' || status === 'initialising' || status === 'finalizing'"
      name="i-lucide-loader-circle"
      class="size-3 animate-spin shrink-0"
    />
    {{ status }}
  </UBadge>
</template>
