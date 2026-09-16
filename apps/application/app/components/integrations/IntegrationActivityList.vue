<script setup lang="ts">
/**
 * The last 50 outbox actions for a connection — what Piwi wrote to the tracker,
 * with the provider error on failures. A dense table on desktop, a card list on
 * mobile, following the UTable slot conventions.
 */
interface ActionRow {
  id: number;
  kind: string;
  entityType: string;
  entityId: number;
  status: string;
  attempts: number;
  error: string | null;
  result: unknown;
  createdAt: string | number | null;
  finishedAt: string | number | null;
}

const props = defineProps<{ connectionId: number }>();

const { data, pending } = await useFetch<{ actions: ActionRow[] }>('/api/integrations/actions', {
  query: { connectionId: props.connectionId },
  default: () => ({ actions: [] as ActionRow[] }),
});
const actions = computed(() => data.value?.actions ?? []);

const STATUS_COLOR: Record<string, 'success' | 'error' | 'warning' | 'neutral'> = {
  done: 'success',
  failed: 'error',
  pending: 'warning',
  skipped: 'neutral',
};

const columns = [
  { accessorKey: 'kind', header: 'Action' },
  { accessorKey: 'entity', header: 'Entity' },
  { accessorKey: 'status', header: 'Status' },
  { accessorKey: 'createdAt', header: 'When' },
];
</script>

<template>
  <div v-if="actions.length > 0 || pending" class="mt-3">
    <p class="text-xs font-medium text-muted mb-2">Recent activity</p>

    <!-- Mobile: card list -->
    <ul class="space-y-2 md:hidden" data-shot="integration-activity">
      <li v-for="a in actions" :key="a.id" class="rounded-lg border border-default p-2 text-xs space-y-1">
        <div class="flex items-center justify-between gap-2">
          <span class="font-mono">{{ a.kind }}</span>
          <UBadge :color="STATUS_COLOR[a.status] ?? 'neutral'" variant="subtle" size="xs">{{ a.status }}</UBadge>
        </div>
        <div class="text-muted">{{ a.entityType }} #{{ a.entityId }}</div>
        <ClientOnly
          ><span class="text-muted">{{ a.createdAt ? new Date(a.createdAt).toLocaleString() : '' }}</span></ClientOnly
        >
        <ErrorText v-if="a.error" :text="a.error" />
      </li>
    </ul>

    <!-- Desktop: table -->
    <div class="hidden md:block">
      <UTable :data="actions" :columns="columns" :loading="pending" class="text-sm">
        <template #kind-cell="{ row }">
          <span class="font-mono text-xs">{{ row.original.kind }}</span>
        </template>
        <template #entity-cell="{ row }">
          <span class="text-xs text-muted">{{ row.original.entityType }} #{{ row.original.entityId }}</span>
        </template>
        <template #status-cell="{ row }">
          <div class="space-y-1">
            <UBadge :color="STATUS_COLOR[row.original.status] ?? 'neutral'" variant="subtle" size="xs">
              {{ row.original.status }}
            </UBadge>
            <ErrorText v-if="row.original.error" :text="row.original.error" class="text-xs" />
          </div>
        </template>
        <template #createdAt-cell="{ row }">
          <ClientOnly>
            <span class="text-xs text-muted">{{
              row.original.createdAt ? new Date(row.original.createdAt).toLocaleString() : ''
            }}</span>
          </ClientOnly>
        </template>
      </UTable>
    </div>
  </div>
</template>
