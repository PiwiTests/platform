<script setup lang="ts">
import type { BadgeProps } from '@nuxt/ui';

/**
 * Status verdict for detail summaries: icon and label in a single subtle
 * badge, the label in sentence case ("Didn't run"). The icon spins while the
 * status is in flight. Given an execution's `retries`, a pass that needed a
 * retry reads "Passed on retry" in the flaky color and icon.
 */
const props = defineProps<{
  status: string;
  /** The execution's retry index; a passed status with one above 0 is a retry pass. */
  retries?: number | null;
  size?: BadgeProps['size'];
}>();

const key = computed(() => (statusPaletteKey(props.status, props.retries) === 'flaky' ? 'flaky' : props.status));
</script>

<template>
  <UBadge :color="getStatusColor(key)" :size="size" variant="subtle" class="gap-1 items-center font-semibold shrink-0">
    <UIcon :name="getStatusIcon(key)" class="size-3.5 shrink-0" :class="{ 'animate-spin': isStatusInFlight(status) }" />
    {{ statusChipLabel(status, retries) }}
  </UBadge>
</template>
