<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'

interface Project {
  id: number
  name: string
  description?: string
  totalRuns: number
  latestRun?: {
    id: number
    status: string
    startTime: string
  }
}

const { data: projects, refresh } = await useFetch<Project[]>('/api/projects')

const UBadge = resolveComponent('UBadge')

function formatDate(date: string | Date | null) {
  if (!date) return 'N/A'
  return new Date(date).toLocaleString()
}

function getStatusColor(status?: string) {
  switch (status) {
    case 'passed': return 'success'
    case 'failed': return 'error'
    case 'timedout': return 'warning'
    case 'interrupted': return 'warning'
    default: return 'neutral'
  }
}

const columns: TableColumn<Project>[] = [
  {
    accessorKey: 'name',
    header: 'Project Name',
    cell: ({ row }) => {
      return h('a', {
        href: `/projects/${row.original.id}`,
        class: 'text-primary hover:underline font-medium text-lg',
        onClick: (e: MouseEvent) => {
          e.preventDefault()
          navigateTo(`/projects/${row.original.id}`)
        }
      }, row.getValue('name'))
    }
  },
  {
    accessorKey: 'totalRuns',
    header: 'Test Runs',
    cell: ({ row }) => `${row.getValue('totalRuns')} runs`
  },
  {
    accessorKey: 'latestRun',
    header: 'Last Run',
    cell: ({ row }) => {
      const latestRun = row.getValue('latestRun') as Project['latestRun']
      return latestRun ? formatDate(latestRun.startTime) : 'N/A'
    }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const latestRun = row.original.latestRun
      if (!latestRun) return ''
      
      const color = getStatusColor(latestRun.status)
      return h(UBadge, { color, size: 'md', class: 'capitalize' }, () => latestRun.status)
    }
  },
  {
    accessorKey: 'actions',
    header: () => h('div', { class: 'text-right' }, 'Actions'),
    cell: ({ row }) => {
      const UButton = resolveComponent('UButton')
      return h('div', { class: 'flex justify-end' },
        h(UButton, {
          to: `/projects/${row.original.id}`,
          size: 'sm',
          variant: 'outline'
        }, () => 'View Details')
      )
    }
  }
]
</script>

<template>
  <UDashboardPanel id="projects">
    <template #header>
      <UDashboardNavbar title="Projects">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            size="md"
            label="Refresh"
            @click="() => refresh()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4">
        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">
              Playwright Test Projects
            </h2>
          </template>

          <UTable
            v-if="projects && projects.length > 0"
            :data="projects"
            :columns="columns"
            :ui="{
              base: 'table-fixed border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default'
            }"
          />

          <div v-else class="text-center py-12 text-gray-500">
            <p class="text-lg mb-2">
              No projects yet
            </p>
            <p class="text-sm">
              Submit test results via the API to create projects
            </p>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
