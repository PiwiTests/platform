<script setup lang="ts">
/**
 * Compact pass-rate gauge: a small colored bar plus the percentage.
 * `rate` is 0..1 over executed runs; null means the case never executed.
 */
const props = defineProps<{ rate: number | null }>();

const percent = computed(() => (props.rate == null ? null : Math.round(props.rate * 100)));

const fillClass = computed(() => (percent.value == null ? '' : PASS_RATE_TONES[passRateTone(percent.value)].bg));
</script>

<template>
  <div v-if="percent != null" class="flex items-center gap-2" :title="`${percent}% of executed runs passed`">
    <div class="h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
      <div :class="[fillClass, 'h-full rounded-full transition-all']" :style="{ width: `${percent}%` }" />
    </div>
    <span class="text-sm font-medium tabular-nums">{{ percent }}%</span>
  </div>
  <span v-else class="text-sm text-muted" title="No executed runs yet">&mdash;</span>
</template>
