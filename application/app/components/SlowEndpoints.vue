<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { EndpointSummary } from '~~/types/api'

defineProps<{
  endpoints: EndpointSummary[] | null
  loading: boolean
}>()

const UBadge = resolveComponent('UBadge')

const endpointColumns: TableColumn<EndpointSummary>[] = [
  {
    accessorKey: 'method',
    header: createSortHeader<EndpointSummary>('Method'),
    cell: ({ row }) => {
      const method = row.getValue('method') as string
      const color = method === 'GET' ? 'sky' : method === 'POST' ? 'green' : method === 'PUT' || method === 'PATCH' ? 'amber' : method === 'DELETE' ? 'red' : 'gray'
      return h(UBadge, { color, variant: 'soft', class: 'font-mono text-xs' }, () => method)
    }
  },
  {
    accessorKey: 'route',
    header: createSortHeader<EndpointSummary>('Route'),
    cell: ({ row }) => h('code', { class: 'text-xs font-mono break-all' }, row.getValue('route'))
  },
  {
    accessorKey: 'count',
    header: createSortHeader<EndpointSummary>('Calls'),
    cell: ({ row }) => row.getValue('count')
  },
  {
    accessorKey: 'avgDuration',
    header: createSortHeader<EndpointSummary>('Avg'),
    cell: ({ row }) => {
      const val = row.getValue('avgDuration') as number
      const color = val > 1000 ? 'text-red-600 font-medium' : val > 500 ? 'text-orange-500 font-medium' : ''
      return h('span', { class: color }, formatDuration(val))
    }
  },
  {
    accessorKey: 'p90Duration',
    header: createSortHeader<EndpointSummary>('P90'),
    cell: ({ row }) => {
      const val = row.getValue('p90Duration') as number
      const color = val > 2000 ? 'text-red-600 font-medium' : val > 1000 ? 'text-orange-500' : ''
      return h('span', { class: color }, formatDuration(val))
    }
  },
  {
    accessorKey: 'maxDuration',
    header: createSortHeader<EndpointSummary>('Max'),
    cell: ({ row }) => formatDuration(row.getValue('maxDuration'))
  },
  {
    accessorKey: 'errorRate',
    header: createSortHeader<EndpointSummary>('Errors'),
    cell: ({ row }) => {
      const rate = row.getValue('errorRate') as number
      if (rate === 0) return h('span', { class: 'text-gray-400' }, '0%')
      return h('span', { class: 'text-red-600 font-medium' }, `${rate}%`)
    }
  }
]
</script>

<template>
  <div>
    <div v-if="loading" class="flex items-center justify-center py-8 text-gray-500 gap-2">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Loading network data...</span>
    </div>

    <UTable
      v-else-if="endpoints && endpoints.length > 0"
      :data="endpoints"
      :columns="endpointColumns"
      :ui="{
        base: 'table-fixed border-separate border-spacing-0',
        thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
        tbody: '[&>tr]:last:[&>td]:border-b-0 [&>tr]:hover:bg-gray-50 dark:[&>tr]:hover:bg-gray-900/50',
        th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
        td: 'border-b border-default'
      }"
    />

    <div v-else class="text-center py-8 text-gray-500">
      <UIcon name="i-lucide-wifi-off" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
      <p>
        No network request data. Add the
        <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded font-mono">@phenx/piwi-dashboard-reporter/fixtures</code>
        to your Playwright config.
      </p>
    </div>
  </div>
</template>
