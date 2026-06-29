<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type { EndpointSummary } from '~~/types/api';

const route = useRoute();
const runId = route.params.id;

const props = defineProps<{
  /** Increments when the run finishes so this tab can refetch. */
  refreshKey?: number;
}>();

const emitSlow = defineEmits<{ endpointsCount: [count: number] }>();

const {
  data: endpoints,
  pending: loading,
  refresh: refreshEndpoints,
} = await useFetch<EndpointSummary[]>(`/api/test-runs/${runId}/network-requests`, { lazy: true, server: false });

watch(endpoints, (val) => {
  emitSlow('endpointsCount', val?.length ?? 0);
});

// Refetch when the run finishes (the tab stays mounted if it's active).
watch(
  () => props.refreshKey,
  (key, oldKey) => {
    if (key !== oldKey && key !== undefined) refreshEndpoints();
  },
);

const endpointColumns: TableColumn<EndpointSummary>[] = [
  {
    accessorKey: 'method',
    header: createSortHeader<EndpointSummary>('Method'),
  },
  {
    accessorKey: 'route',
    header: createSortHeader<EndpointSummary>('Route'),
  },
  {
    accessorKey: 'count',
    header: createSortHeader<EndpointSummary>('Calls'),
  },
  {
    accessorKey: 'avgDuration',
    header: createSortHeader<EndpointSummary>('Avg'),
  },
  {
    accessorKey: 'p90Duration',
    header: createSortHeader<EndpointSummary>('P90'),
  },
  {
    accessorKey: 'maxDuration',
    header: createSortHeader<EndpointSummary>('Max'),
  },
  {
    accessorKey: 'errorRate',
    header: createSortHeader<EndpointSummary>('Errors'),
  },
];
</script>

<template>
  <div class="flex flex-col overflow-hidden">
    <div v-if="loading" class="flex-1 flex items-center justify-center text-gray-500 gap-2">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Loading network data...</span>
    </div>

    <UTable
      v-else-if="endpoints && endpoints.length > 0"
      sticky
      :data="endpoints"
      :columns="endpointColumns"
      class="flex-1 min-h-0"
      :ui="{
        base: 'table-fixed border-separate border-spacing-0',
        thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
        tbody: '[&>tr]:last:[&>td]:border-b-0 [&>tr]:hover:bg-gray-50 dark:[&>tr]:hover:bg-gray-900/50',
        th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
        td: 'border-b border-default',
      }"
    >
      <template #method-cell="{ row }">
        <UBadge
          :color="
            row.original.method === 'GET'
              ? 'info'
              : row.original.method === 'POST'
                ? 'success'
                : row.original.method === 'PUT' || row.original.method === 'PATCH'
                  ? 'warning'
                  : row.original.method === 'DELETE'
                    ? 'error'
                    : 'neutral'
          "
          variant="soft"
          class="font-mono text-xs"
        >
          {{ row.original.method }}
        </UBadge>
      </template>
      <template #route-cell="{ row }">
        <code class="text-xs font-mono break-all">{{ row.original.route }}</code>
      </template>
      <template #avgDuration-cell="{ row }">
        <span
          :class="
            row.original.avgDuration > 1000
              ? 'text-red-600 font-medium'
              : row.original.avgDuration > 500
                ? 'text-orange-500 font-medium'
                : ''
          "
        >
          {{ formatDuration(row.original.avgDuration) }}
        </span>
      </template>
      <template #p90Duration-cell="{ row }">
        <span
          :class="
            row.original.p90Duration > 2000
              ? 'text-red-600 font-medium'
              : row.original.p90Duration > 1000
                ? 'text-orange-500'
                : ''
          "
        >
          {{ formatDuration(row.original.p90Duration) }}
        </span>
      </template>
      <template #errorRate-cell="{ row }">
        <span v-if="row.original.errorRate === 0" class="text-gray-400">0%</span>
        <span v-else class="text-red-600 font-medium">{{ row.original.errorRate }}%</span>
      </template>
    </UTable>

    <div v-else class="flex-1 flex items-center justify-center text-center text-gray-500">
      <UIcon name="i-lucide-wifi-off" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
      <p>
        No network request data. Add the
        <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded font-mono">@piwitests/reporter</code>
        fixtures to your test setup.
      </p>
    </div>
  </div>
</template>
