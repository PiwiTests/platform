<script setup lang="ts">
const props = defineProps<{
  passed: number
  failed: number
  skipped: number
  flaky: number
  total: number
}>()

const segments = computed(() => {
  if (!props.total) return []

  const pct = (n: number) => ((n / props.total) * 100).toFixed(1)

  return [
    { key: 'passed', label: 'Passed', count: props.passed, pct: pct(props.passed), color: 'bg-green-500' },
    { key: 'failed', label: 'Failed', count: props.failed, pct: pct(props.failed), color: 'bg-red-500' },
    { key: 'flaky', label: 'Flaky', count: props.flaky, pct: pct(props.flaky), color: 'bg-purple-500' },
    { key: 'skipped', label: 'Skipped', count: props.skipped, pct: pct(props.skipped), color: 'bg-gray-400' }
  ].filter(s => s.count > 0)
})
</script>

<template>
  <UTooltip :ui="{ content: 'overflow-visible !p-0' }">
    <div
      v-if="total > 0"
      class="flex h-2.5 w-full min-w-30 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700"
    >
      <div
        v-for="seg in segments"
        :key="seg.key"
        :class="[seg.color, 'h-full transition-all']"
        :style="{ width: seg.pct + '%' }"
      />
    </div>
    <div v-else class="text-xs text-gray-400 dark:text-gray-500 italic">
      No tests
    </div>

    <template #content>
      <div class="min-w-52 space-y-1.5 rounded-md bg-gray-900 px-3 py-2 text-sm shadow-lg">
        <div class="font-semibold text-white">
          {{ total }} tests total
        </div>
        <div
          v-for="seg in segments"
          :key="seg.key"
          class="flex items-center gap-2 whitespace-nowrap"
        >
          <span :class="[seg.color, 'inline-block h-2.5 w-2.5 shrink-0 rounded-sm']" />
          <span class="text-white">{{ seg.label }}</span>
          <span class="ml-4 tabular-nums font-medium text-white">{{ seg.count }}</span>
          <span class="ml-auto tabular-nums text-gray-300 text-xs">{{ seg.pct }}%</span>
        </div>
      </div>
    </template>
  </UTooltip>
</template>
