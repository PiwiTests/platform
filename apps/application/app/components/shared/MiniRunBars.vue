<script setup lang="ts">
const props = withDefaults(
  defineProps<{
    runs: Array<{ id: number; status: string; flakyTests: number; passedTests: number; totalTests: number }>;
    height?: number;
    maxBars?: number;
  }>(),
  { height: 28, maxBars: 20 },
);

/** A passed run with flaky tests reads as flaky; every other run takes its status color. */
function barColorClass(run: { status: string; flakyTests: number }): string {
  if (run.flakyTests > 0 && run.status === 'passed') return STATUS_PALETTE.flaky.bg;
  return statusPalette(run.status).bg;
}

function barTitle(run: {
  id: number;
  status: string;
  passedTests: number;
  totalTests: number;
  flakyTests: number;
}): string {
  const parts = [`Run #${run.id}`, `Status: ${run.status}`, `${run.passedTests}/${run.totalTests} passed`];
  if (run.flakyTests > 0) parts.push(`${run.flakyTests} flaky`);
  return parts.join(' · ');
}

const emptyCount = computed(() => Math.max(0, props.maxBars - props.runs.length));
</script>

<template>
  <div class="flex items-stretch gap-px" :style="{ height: `${height}px` }">
    <NuxtLink
      v-for="run in runs"
      :key="run.id"
      :to="`/test-runs/${run.id}`"
      :title="barTitle(run)"
      class="flex-1 rounded-sm transition-opacity hover:opacity-70 min-w-0"
      :class="barColorClass(run)"
    />
    <div v-for="i in emptyCount" :key="`empty-${i}`" class="flex-1 rounded-sm bg-gray-100 dark:bg-gray-800 min-w-0" />
  </div>
</template>
