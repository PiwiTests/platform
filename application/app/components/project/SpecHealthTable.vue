<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';

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

const specs = computed(() => data.value?.specs ?? []);

function passRateColor(rate: number): string {
  if (rate >= 0.9) return 'bg-green-500';
  if (rate >= 0.7) return 'bg-amber-500';
  if (rate > 0) return 'bg-red-500';
  return 'bg-gray-300 dark:bg-gray-600';
}

function passRateTextColor(rate: number): string {
  if (rate >= 0.9) return 'text-green-600 dark:text-green-400';
  if (rate >= 0.7) return 'text-amber-600 dark:text-amber-400';
  if (rate > 0) return 'text-red-600 dark:text-red-400';
  return 'text-gray-500';
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

const columns: TableColumn<SpecHealth>[] = [
  { accessorKey: 'prefix', header: createSortHeader<SpecHealth>('Spec prefix') },
  { accessorKey: 'passRate', header: createSortHeader<SpecHealth>('Pass rate') },
  { accessorKey: 'flakyRate', header: createSortHeader<SpecHealth>('Flaky') },
  { accessorKey: 'failureCount', header: createSortHeader<SpecHealth>('Failures') },
  { accessorKey: 'testCount', header: createSortHeader<SpecHealth>('Tests') },
  { accessorKey: 'avgDuration', header: createSortHeader<SpecHealth>('Avg time') },
];
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">
          Spec-file health overview — pass rate, flaky rate, and failure count per spec prefix
        </p>
        <USelect v-model="days" :items="DAY_OPTIONS" size="xs" class="w-32" />
      </div>
    </template>

    <LoadingState v-if="pending" />

    <EmptyState
      v-else-if="specs.length === 0"
      text="No data"
      description="No spec health data available for the selected period."
    />

    <UTable v-else :data="specs" :columns="columns">
      <template #prefix-cell="{ row }">
        <NuxtLink
          :to="`/projects/${projectId}/test-cases?file=${encodeURIComponent(row.original.prefix)}`"
          class="flex items-center gap-2 min-w-0 text-primary hover:underline"
          :title="row.original.prefix"
        >
          <span class="inline-block size-3 rounded shrink-0" :class="passRateColor(row.original.passRate)" />
          <span class="truncate font-mono text-xs">{{ row.original.prefix }}</span>
        </NuxtLink>
      </template>

      <template #passRate-cell="{ row }">
        <span class="font-medium tabular-nums" :class="passRateTextColor(row.original.passRate)">
          {{ passRateLabel(row.original.passRate) }}
        </span>
      </template>

      <template #flakyRate-cell="{ row }">
        <span class="tabular-nums">{{ Math.round(row.original.flakyRate * 100) }}%</span>
      </template>

      <template #failureCount-cell="{ row }">
        <span class="tabular-nums" :class="row.original.failureCount > 0 ? 'text-red-600 dark:text-red-400' : ''">
          {{ row.original.failureCount }}
        </span>
      </template>

      <template #testCount-cell="{ row }">
        <span class="tabular-nums text-gray-500">{{ row.original.testCount }}</span>
      </template>

      <template #avgDuration-cell="{ row }">
        <span class="tabular-nums text-gray-500">{{ formatMs(row.original.avgDuration) }}</span>
      </template>
    </UTable>
  </UCard>
</template>
