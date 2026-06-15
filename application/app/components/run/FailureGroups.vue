<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type { FailureGroup } from '~~/types/api';

const emit = defineEmits<{
  selectCluster: [clusterId: number];
}>();

const route = useRoute();
const runId = route.params.id;

const { data: groups, pending: loading } = await useFetch<FailureGroup[]>(`/api/test-runs/${runId}/failure-groups`, {
  lazy: true,
  server: false,
});

const diagnosisClusterId = ref<number | null>(null);

const columns: TableColumn<FailureGroup>[] = [
  { accessorKey: 'signature', header: createSortHeader<FailureGroup>('Signature') },
  { accessorKey: 'errorType', header: createSortHeader<FailureGroup>('Type') },
  { accessorKey: 'status', header: createSortHeader<FailureGroup>('Status') },
  { accessorKey: 'caseCount', header: createSortHeader<FailureGroup>('Tests') },
  { accessorKey: 'signals', header: 'Signals' },
  { accessorKey: 'diagnosis', header: 'AI' },
  { accessorKey: 'firstSeenRunId', header: createSortHeader<FailureGroup>('Known since') },
  { id: 'actions', header: 'Actions' },
];

const totalCases = computed(() => groups.value?.reduce((sum, g) => sum + g.caseCount, 0) ?? 0);
</script>

<template>
  <div class="pt-4 space-y-3">
    <div v-if="loading" class="flex items-center justify-center py-8 text-gray-500 gap-2">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Grouping failures...</span>
    </div>

    <template v-else-if="groups && groups.length">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ totalCases }} failing {{ totalCases === 1 ? 'test' : 'tests' }} across {{ groups.length }}
        {{ groups.length === 1 ? 'group' : 'groups' }} — each group likely shares one root cause
      </p>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <UTable :data="groups" :columns="columns">
          <template #actions-header>
            <div class="text-right">Actions</div>
          </template>

          <template #signature-cell="{ row }">
            <div class="min-w-0 space-y-0.5">
              <span class="font-mono text-sm block truncate" :title="row.original.signature">{{
                row.original.signature
              }}</span>
              <span v-if="row.original.selector" class="text-xs text-gray-500 truncate block">
                Locator: <code class="font-mono">{{ row.original.selector }}</code>
              </span>
            </div>
          </template>

          <template #errorType-cell="{ row }">
            <UBadge
              v-if="row.original.errorType"
              :color="clusterErrorTypeColor(row.original.errorType)"
              variant="subtle"
              size="sm"
            >
              {{ row.original.errorType }}
            </UBadge>
            <span v-else class="text-gray-400 text-xs">—</span>
          </template>

          <template #status-cell="{ row }">
            <UBadge
              v-if="row.original.status"
              :color="clusterStatusColor(row.original.status)"
              variant="subtle"
              size="sm"
            >
              {{ row.original.status }}
            </UBadge>
            <span v-else class="text-gray-400 text-xs">—</span>
          </template>

          <template #caseCount-cell="{ row }">
            <span class="text-sm tabular-nums">{{ row.original.caseCount }}</span>
          </template>

          <template #signals-cell="{ row }">
            <div
              v-if="row.original.isNew || row.original.flaky || row.original.workerCorrelated"
              class="flex flex-wrap gap-1"
            >
              <UBadge v-if="row.original.isNew" color="warning" variant="subtle" size="sm"> New </UBadge>
              <UBadge v-if="row.original.flaky" color="warning" variant="outline" size="sm"> Flaky </UBadge>
              <UBadge
                v-if="row.original.workerCorrelated"
                color="info"
                variant="outline"
                size="sm"
                title="All failures ran on the same worker"
              >
                Same worker
              </UBadge>
            </div>
            <span v-else class="text-gray-400 text-xs">—</span>
          </template>

          <template #diagnosis-cell="{ row }">
            <div
              v-if="row.original.diagnosis?.status === 'running'"
              class="flex items-center gap-1 text-xs text-gray-500"
            >
              <UIcon name="i-lucide-loader-2" class="size-3 animate-spin" />
              Running
            </div>
            <UBadge
              v-else-if="row.original.diagnosis?.status === 'completed' && row.original.diagnosis.category"
              color="neutral"
              variant="subtle"
              size="sm"
              class="gap-1"
            >
              <UIcon name="i-lucide-sparkles" class="size-3" />
              {{ row.original.diagnosis.category }}
            </UBadge>
            <span v-else class="text-gray-400 text-xs">—</span>
          </template>

          <template #firstSeenRunId-cell="{ row }">
            <span v-if="row.original.isNew" class="text-xs font-medium text-warning-500">New in this run</span>
            <div v-else class="text-sm text-gray-500 whitespace-nowrap">
              <NuxtLink :to="`/test-runs/${row.original.firstSeenRunId}`" class="text-primary hover:underline">
                run #{{ row.original.firstSeenRunId }}
              </NuxtLink>
              <span v-if="row.original.firstSeenAt" class="ml-1 text-xs text-gray-400">
                ({{ formatRelativeTime(row.original.firstSeenAt) }})
              </span>
            </div>
          </template>

          <template #actions-cell="{ row }">
            <div class="flex justify-end gap-2">
              <UButton size="sm" color="primary" variant="soft" @click="emit('selectCluster', row.original.clusterId)">
                Filter
              </UButton>
              <UButton
                size="sm"
                color="neutral"
                variant="outline"
                icon="i-lucide-sparkles"
                @click="diagnosisClusterId = row.original.clusterId"
              >
                Diagnose
              </UButton>
              <UButton
                :to="`/failure-clusters/${row.original.clusterId}`"
                size="sm"
                variant="outline"
                trailing-icon="i-lucide-arrow-right"
              >
                View
              </UButton>
            </div>
          </template>
        </UTable>
      </UCard>
    </template>

    <div v-else class="flex flex-col items-center justify-center py-8 text-gray-500 gap-2">
      <UIcon name="i-lucide-party-popper" class="size-6" />
      <span>No failure groups — failed tests without error details are not grouped</span>
    </div>
  </div>

  <UModal
    :open="diagnosisClusterId !== null"
    title="AI Diagnosis"
    :ui="{ content: 'max-w-2xl' }"
    @update:open="
      (v) => {
        if (!v) diagnosisClusterId = null;
      }
    "
  >
    <template #body>
      <ClusterDiagnosis v-if="diagnosisClusterId !== null" :cluster-id="diagnosisClusterId" />
    </template>
  </UModal>
</template>
