<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { ProjectFailureCluster } from '~~/types/api'

const props = defineProps<{
  projectId: string | number
}>()

const statusFilter = ref<string | undefined>(undefined)
const { data: clusters, pending: loading } = await useFetch<ProjectFailureCluster[]>(
  () => {
    const params = new URLSearchParams()
    if (statusFilter.value) params.set('status', statusFilter.value)
    const qs = params.toString()
    return `/api/projects/${props.projectId}/failure-clusters${qs ? `?${qs}` : ''}`
  },
  { lazy: true, server: false, watch: [statusFilter] }
)

const statusColors: Record<string, 'success' | 'warning' | 'neutral'> = {
  open: 'warning',
  resolved: 'success',
  ignored: 'neutral'
}

const errorTypeColors: Record<string, 'error' | 'warning' | 'info' | 'neutral' | 'secondary'> = {
  'timeout': 'warning',
  'assertion': 'error',
  'strict-mode': 'info',
  'navigation': 'secondary',
  'crash': 'error',
  'unknown': 'neutral'
}

const columns: TableColumn<ProjectFailureCluster>[] = [
  { accessorKey: 'signature', header: createSortHeader<ProjectFailureCluster>('Signature') },
  { accessorKey: 'errorType', header: createSortHeader<ProjectFailureCluster>('Type') },
  { accessorKey: 'status', header: createSortHeader<ProjectFailureCluster>('Status') },
  { accessorKey: 'affectedTests', header: createSortHeader<ProjectFailureCluster>('Tests') },
  { accessorKey: 'occurrences', header: createSortHeader<ProjectFailureCluster>('Occurrences') },
  { accessorKey: 'diagnosis', header: 'AI' },
  { accessorKey: 'lastSeenAt', header: createSortHeader<ProjectFailureCluster>('Last seen') },
  { id: 'actions', header: 'Actions' }
]
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">
          Ongoing failure signatures grouped by normalized error. Each cluster represents a distinct root cause.
        </p>
        <USelect
          v-model="statusFilter"
          :items="[
            { label: 'All', value: undefined },
            { label: 'Open', value: 'open' },
            { label: 'Resolved', value: 'resolved' },
            { label: 'Ignored', value: 'ignored' }
          ]"
          size="xs"
          class="w-32"
        />
      </div>
    </template>

    <UTable :data="clusters ?? []" :columns="columns" :loading="loading">
      <template #actions-header>
        <div class="text-right">
          Actions
        </div>
      </template>

      <template #signature-cell="{ row }">
        <div class="min-w-0 space-y-0.5">
          <NuxtLink
            :to="`/failure-clusters/${row.original.id}`"
            class="font-mono text-sm text-primary hover:underline truncate block"
            :title="row.original.signature"
          >
            {{ row.original.signature }}
          </NuxtLink>
          <p v-if="row.original.triageNote" class="text-xs text-gray-500 italic truncate">
            {{ row.original.triageNote }}
          </p>
        </div>
      </template>

      <template #errorType-cell="{ row }">
        <UBadge
          v-if="row.original.errorType"
          :color="errorTypeColors[row.original.errorType] || 'neutral'"
          variant="subtle"
          size="sm"
        >
          {{ row.original.errorType }}
        </UBadge>
        <span v-else class="text-gray-400 text-xs">—</span>
      </template>

      <template #status-cell="{ row }">
        <UBadge :color="statusColors[row.original.status] || 'neutral'" variant="subtle" size="sm">
          {{ row.original.status }}
        </UBadge>
      </template>

      <template #affectedTests-cell="{ row }">
        <span class="text-sm tabular-nums">{{ row.original.affectedTests }}</span>
      </template>

      <template #occurrences-cell="{ row }">
        <span class="text-sm tabular-nums">{{ row.original.occurrences }}</span>
      </template>

      <template #diagnosis-cell="{ row }">
        <UBadge
          v-if="row.original.diagnosis?.status === 'completed' && row.original.diagnosis.category"
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

      <template #lastSeenAt-cell="{ row }">
        <div class="text-sm text-gray-500 whitespace-nowrap">
          <NuxtLink :to="`/test-runs/${row.original.lastSeenRunId}`" class="text-primary hover:underline">
            run #{{ row.original.lastSeenRunId }}
          </NuxtLink>
          <span v-if="row.original.lastSeenAt" class="ml-1 text-xs text-gray-400">
            ({{ formatRelativeTime(row.original.lastSeenAt) }})
          </span>
        </div>
      </template>

      <template #actions-cell="{ row }">
        <div class="flex justify-end">
          <UButton
            :to="`/failure-clusters/${row.original.id}`"
            size="sm"
            variant="outline"
            trailing-icon="i-lucide-arrow-right"
          >
            View
          </UButton>
        </div>
      </template>
    </UTable>

    <p v-if="!loading && clusters && clusters.length === 0" class="text-sm text-gray-500 py-4 text-center">
      No failure clusters recorded for this project.
    </p>
  </UCard>
</template>
