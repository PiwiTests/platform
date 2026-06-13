<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { FailureGroup } from '~~/types/api'

const emit = defineEmits<{
  selectCluster: [clusterId: number]
}>()

const route = useRoute()
const runId = route.params.id

const { data: groups, pending: loading } = await useFetch<FailureGroup[]>(
  `/api/test-runs/${runId}/failure-groups`,
  { lazy: true, server: false }
)

const diagnosisClusterId = ref<number | null>(null)

const errorTypeColors: Record<string, 'error' | 'warning' | 'info' | 'neutral' | 'secondary'> = {
  'timeout': 'warning',
  'assertion': 'error',
  'strict-mode': 'info',
  'navigation': 'secondary',
  'crash': 'error',
  'unknown': 'neutral'
}

const statusColors: Record<string, 'success' | 'warning' | 'neutral'> = {
  open: 'warning',
  resolved: 'success',
  ignored: 'neutral'
}

const UBadge = resolveComponent('UBadge')
const UButton = resolveComponent('UButton')
const UIcon = resolveComponent('UIcon')

const columns: TableColumn<FailureGroup>[] = [
  {
    accessorKey: 'signature',
    header: 'Signature',
    cell: ({ row }) => {
      const group = row.original
      const children = [
        h('span', {
          class: 'font-mono text-sm block truncate',
          title: group.signature
        }, group.signature)
      ]
      if (group.selector) {
        children.push(h('span', { class: 'text-xs text-gray-500 truncate block' }, [
          'Locator: ',
          h('code', { class: 'font-mono' }, group.selector)
        ]))
      }
      return h('div', { class: 'min-w-0 space-y-0.5' }, children)
    }
  },
  {
    accessorKey: 'errorType',
    header: 'Type',
    cell: ({ row }) => {
      const t = row.original.errorType
      if (!t) return h('span', { class: 'text-gray-400 text-xs' }, '—')
      return h(UBadge, { color: errorTypeColors[t] || 'neutral', variant: 'subtle', size: 'sm' }, () => t)
    }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const s = row.original.status
      if (!s) return h('span', { class: 'text-gray-400 text-xs' }, '—')
      return h(UBadge, { color: statusColors[s] || 'neutral', variant: 'subtle', size: 'sm' }, () => s)
    }
  },
  {
    accessorKey: 'caseCount',
    header: 'Tests',
    cell: ({ row }) => h('span', { class: 'text-sm tabular-nums' }, String(row.original.caseCount))
  },
  {
    accessorKey: 'signals',
    header: 'Signals',
    cell: ({ row }) => {
      const group = row.original
      const badges: ReturnType<typeof h>[] = []
      if (group.isNew) badges.push(h(UBadge, { color: 'warning', variant: 'subtle', size: 'sm' }, () => 'New'))
      if (group.flaky) badges.push(h(UBadge, { color: 'warning', variant: 'outline', size: 'sm' }, () => 'Flaky'))
      if (group.workerCorrelated) badges.push(h(UBadge, {
        color: 'info',
        variant: 'outline',
        size: 'sm',
        title: 'All failures ran on the same worker'
      }, () => 'Same worker'))
      if (!badges.length) return h('span', { class: 'text-gray-400 text-xs' }, '—')
      return h('div', { class: 'flex flex-wrap gap-1' }, badges)
    }
  },
  {
    accessorKey: 'diagnosis',
    header: 'AI',
    cell: ({ row }) => {
      const d = row.original.diagnosis
      if (!d) return h('span', { class: 'text-gray-400 text-xs' }, '—')
      if (d.status === 'running') {
        return h('div', { class: 'flex items-center gap-1 text-xs text-gray-500' }, [
          h(UIcon, { name: 'i-lucide-loader-2', class: 'size-3 animate-spin' }),
          'Running'
        ])
      }
      if (d.status === 'completed' && d.category) {
        return h(UBadge, { color: 'neutral', variant: 'subtle', size: 'sm', class: 'gap-1' }, () => [
          h(UIcon, { name: 'i-lucide-sparkles', class: 'size-3' }),
          d.category
        ])
      }
      return h('span', { class: 'text-gray-400 text-xs' }, '—')
    }
  },
  {
    accessorKey: 'firstSeenRunId',
    header: 'Known since',
    cell: ({ row }) => {
      const group = row.original
      if (group.isNew) return h('span', { class: 'text-xs text-warning-500 font-medium' }, 'New in this run')
      const rel = group.firstSeenAt ? formatRelativeTime(group.firstSeenAt) : null
      return h('div', { class: 'text-sm text-gray-500 whitespace-nowrap' }, [
        h('a', {
          href: `/test-runs/${group.firstSeenRunId}`,
          class: 'text-primary hover:underline',
          onClick: (e: MouseEvent) => {
            e.preventDefault()
            navigateTo(`/test-runs/${group.firstSeenRunId}`)
          }
        }, `run #${group.firstSeenRunId}`),
        rel ? h('span', { class: 'ml-1 text-xs text-gray-400' }, `(${rel})`) : null
      ])
    }
  },
  {
    accessorKey: 'actions',
    header: () => h('div', { class: 'text-right' }, 'Actions'),
    cell: ({ row }) => {
      const group = row.original
      return h('div', { class: 'flex justify-end gap-2' }, [
        h(UButton, {
          size: 'sm',
          color: 'primary',
          variant: 'soft',
          onClick: () => emit('selectCluster', group.clusterId)
        }, () => 'Filter'),
        h(UButton, {
          size: 'sm',
          color: 'neutral',
          variant: 'outline',
          icon: 'i-lucide-sparkles',
          onClick: () => { diagnosisClusterId.value = group.clusterId }
        }, () => 'Diagnose'),
        h(UButton, {
          size: 'sm',
          variant: 'outline',
          trailingIcon: 'i-lucide-arrow-right',
          to: `/failure-clusters/${group.clusterId}`
        }, () => 'View')
      ])
    }
  }
]

const totalCases = computed(() => groups.value?.reduce((sum, g) => sum + g.caseCount, 0) ?? 0)
</script>

<template>
  <div class="pt-4 space-y-3">
    <div v-if="loading" class="flex items-center justify-center py-8 text-gray-500 gap-2">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Grouping failures...</span>
    </div>

    <template v-else-if="groups && groups.length">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ totalCases }} failing {{ totalCases === 1 ? 'test' : 'tests' }} across
        {{ groups.length }} {{ groups.length === 1 ? 'group' : 'groups' }} — each group likely shares one root cause
      </p>

      <UCard :ui="{ body: 'p-0 sm:p-0' }">
        <UTable :data="groups" :columns="columns" />
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
    @update:open="(v) => { if (!v) diagnosisClusterId = null }"
  >
    <template #body>
      <ClusterDiagnosis v-if="diagnosisClusterId !== null" :cluster-id="diagnosisClusterId" />
    </template>
  </UModal>
</template>
