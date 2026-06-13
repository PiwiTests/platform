<script setup lang="ts">
import { h, resolveComponent } from 'vue'
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

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const UIcon = resolveComponent('UIcon')

const columns: TableColumn<ProjectFailureCluster>[] = [
  {
    accessorKey: 'signature',
    header: 'Signature',
    cell: ({ row }) => {
      const cluster = row.original
      return h('div', { class: 'space-y-1 min-w-0' }, [
        h('a', {
          href: `/failure-clusters/${cluster.id}`,
          class: 'font-mono text-sm text-primary hover:underline truncate block',
          title: cluster.signature,
          onClick: (e: MouseEvent) => {
            e.preventDefault()
            navigateTo(`/failure-clusters/${cluster.id}`)
          }
        }, cluster.signature),
        cluster.triageNote
          ? h('p', { class: 'text-xs text-gray-500 italic truncate' }, cluster.triageNote)
          : null
      ])
    }
  },
  {
    accessorKey: 'errorType',
    header: 'Type',
    cell: ({ row }) => {
      const t = row.original.errorType
      if (!t) return h('span', { class: 'text-gray-400 text-xs' }, '—')
      return h(UBadge, {
        color: errorTypeColors[t] || 'neutral',
        variant: 'subtle',
        size: 'sm'
      }, () => t)
    }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const s = row.original.status
      return h(UBadge, {
        color: statusColors[s] || 'neutral',
        variant: 'subtle',
        size: 'sm'
      }, () => s)
    }
  },
  {
    accessorKey: 'affectedTests',
    header: 'Tests',
    cell: ({ row }) => h('span', { class: 'text-sm tabular-nums' }, String(row.original.affectedTests))
  },
  {
    accessorKey: 'occurrences',
    header: 'Occurrences',
    cell: ({ row }) => h('span', { class: 'text-sm tabular-nums' }, String(row.original.occurrences))
  },
  {
    accessorKey: 'diagnosis',
    header: 'AI',
    cell: ({ row }) => {
      const d = row.original.diagnosis
      if (!d || d.status !== 'completed' || !d.category) return h('span', { class: 'text-gray-400 text-xs' }, '—')
      return h(UBadge, {
        color: 'neutral',
        variant: 'subtle',
        size: 'sm',
        class: 'gap-1'
      }, () => [
        h(UIcon, { name: 'i-lucide-sparkles', class: 'size-3' }),
        d.category
      ])
    }
  },
  {
    accessorKey: 'lastSeenAt',
    header: 'Last seen',
    cell: ({ row }) => {
      const cluster = row.original
      const rel = cluster.lastSeenAt ? formatRelativeTime(cluster.lastSeenAt) : null
      return h('div', { class: 'text-sm text-gray-500 whitespace-nowrap' }, [
        h('a', {
          href: `/test-runs/${cluster.lastSeenRunId}`,
          class: 'text-primary hover:underline',
          onClick: (e: MouseEvent) => {
            e.preventDefault()
            navigateTo(`/test-runs/${cluster.lastSeenRunId}`)
          }
        }, `run #${cluster.lastSeenRunId}`),
        rel ? h('span', { class: 'ml-1 text-xs text-gray-400' }, `(${rel})`) : null
      ])
    }
  },
  {
    accessorKey: 'actions',
    header: () => h('div', { class: 'text-right' }, 'Actions'),
    cell: ({ row }) => h('div', { class: 'flex justify-end' }, [
      h(UButton, {
        to: `/failure-clusters/${row.original.id}`,
        size: 'sm',
        variant: 'outline',
        trailingIcon: 'i-lucide-arrow-right'
      }, () => 'View')
    ])
  }
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

    <UTable
      :data="clusters ?? []"
      :columns="columns"
      :loading="loading"
    />

    <p v-if="!loading && clusters && clusters.length === 0" class="text-sm text-gray-500 py-4 text-center">
      No failure clusters recorded for this project.
    </p>
  </UCard>
</template>
