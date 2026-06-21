<script setup lang="ts">
import type { Period } from '~~/types/api';

const props = defineProps<{
  projectId: string | number;
}>();

interface SpecHealth {
  prefix: string;
  passRate: number;
  flakyRate: number;
  failureCount: number;
  testCount: number;
  avgDuration: number;
}

const days = ref(30);
const { data, pending } = await useFetch<{ specs: SpecHealth[] }>(
  () => `/api/projects/${props.projectId}/spec-health?days=${days.value}`,
  { lazy: true, server: false, watch: [days] },
);

function passRateColor(rate: number): string {
  if (rate >= 0.9) return 'bg-green-500';
  if (rate >= 0.7) return 'bg-amber-500';
  if (rate > 0) return 'bg-red-500';
  return 'bg-gray-300 dark:bg-gray-600';
}

function passRateLabel(rate: number): string {
  return `${Math.round(rate * 100)}%`;
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const DAY_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
];
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <p class="text-sm text-gray-500">
            Spec-file health overview — pass rate, flaky rate, and failure count per spec prefix
          </p>
        </div>
        <USelect v-model="days" :items="DAY_OPTIONS" size="xs" class="w-32" />
      </div>
    </template>

    <LoadingState v-if="pending" />

    <EmptyState
      v-else-if="!data?.specs?.length"
      text="No data"
      description="No spec health data available for the selected period."
    />

    <div v-else class="space-y-2">
      <div class="grid grid-cols-[1fr_80px_80px_80px_80px] gap-2 text-xs font-medium text-gray-500 px-2 pb-1 border-b">
        <span>Spec prefix</span>
        <span class="text-right">Pass rate</span>
        <span class="text-right">Flaky</span>
        <span class="text-right">Failures</span>
        <span class="text-right">Avg time</span>
      </div>

      <NuxtLink
        v-for="spec in data.specs"
        :key="spec.prefix"
        :to="`/projects/${projectId}/test-cases?file=${encodeURIComponent(spec.prefix)}`"
        class="grid grid-cols-[1fr_80px_80px_80px_80px] gap-2 items-center px-2 py-1.5 rounded hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors text-sm"
      >
        <div class="flex items-center gap-2 min-w-0">
          <span
            class="inline-block size-3 rounded shrink-0"
            :class="passRateColor(spec.passRate)"
            :title="passRateLabel(spec.passRate)"
          />
          <span class="truncate font-mono text-xs">{{ spec.prefix }}</span>
        </div>
        <span class="text-right tabular-nums">{{ passRateLabel(spec.passRate) }}</span>
        <span class="text-right tabular-nums">{{ Math.round(spec.flakyRate * 100) }}%</span>
        <span class="text-right tabular-nums">{{ spec.failureCount }}</span>
        <span class="text-right tabular-nums text-gray-500">{{ formatMs(spec.avgDuration) }}</span>
      </NuxtLink>
    </div>
  </UCard>
</template>
