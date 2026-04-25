<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { ProjectWithStats } from '~~/types/api'
import { formatDuration } from '~/utils'

const { data: projects, refresh } = await useFetch<ProjectWithStats[]>('/api/projects')

const UBadge = resolveComponent('UBadge')
const TestStatusBar = resolveComponent('TestStatusBar')
const RunReports = resolveComponent('RunReports')

const columns: TableColumn<ProjectWithStats>[] = [
  {
    accessorKey: 'name',
    header: createSortHeader<ProjectWithStats>('Project Name'),
    cell: ({ row }) => {
      const displayName = (row.original.label || row.getValue('name')) as string

      return h('div', { class: 'flex items-center gap-2' }, [
        h('a', {
          href: `/projects/${row.original.id}`,
          class: 'text-primary hover:underline font-medium text-lg',
          onClick: (e: MouseEvent) => {
            e.preventDefault()
            navigateTo(`/projects/${row.original.id}`)
          }
        }, displayName)
      ])
    }
  },
  {
    accessorKey: 'totalRuns',
    header: createSortHeader<ProjectWithStats>('Test Runs'),
    cell: ({ row }) => `${row.getValue('totalRuns')} runs`
  },
  {
    accessorKey: 'latestRun',
    header: createSortHeader<ProjectWithStats>('Last Run'),
    cell: ({ row }) => {
      const latestRun = row.getValue('latestRun') as ProjectWithStats['latestRun']
      return latestRun ? formatDate(latestRun.startTime) : 'N/A'
    }
  },
  {
    accessorKey: 'duration',
    header: createSortHeader<ProjectWithStats>('Duration'),
    cell: ({ row }) => {
      const latestRun = row.original.latestRun
      return latestRun?.duration != null ? formatDuration(latestRun.duration) : '—'
    }
  },
  {
    accessorKey: 'status',
    header: createSortHeader<ProjectWithStats>('Status'),
    cell: ({ row }) => {
      const latestRun = row.original.latestRun
      if (!latestRun) return ''

      const color = getStatusColor(latestRun.status)
      return h(UBadge, { color, size: 'md', class: 'capitalize' }, () => latestRun.status)
    }
  },
  {
    accessorKey: 'testRatio',
    header: 'Test Status',
    cell: ({ row }) => {
      const latestRun = row.original.latestRun
      if (!latestRun) return h('span', { class: 'text-xs text-gray-400 italic' }, 'No data')

      return h(TestStatusBar, {
        passed: latestRun.passedTests,
        failed: latestRun.failedTests,
        skipped: latestRun.skippedTests,
        flaky: latestRun.flakyTests,
        total: latestRun.totalTests
      })
    }
  },
  {
    accessorKey: 'report',
    header: 'Reports',
    cell: ({ row }) => {
      const latestRun = row.original.latestRun
      if (!latestRun) return ''
      return h(RunReports, {
        reports: latestRun.reports,
        legacyPath: latestRun.reportPath,
        legacySize: latestRun.reportSize
      })
    }
  },
  {
    accessorKey: 'actions',
    header: () => h('div', { class: 'text-right' }, 'Actions'),
    cell: ({ row }) => {
      const UButton = resolveComponent('UButton')
      return h('div', { class: 'flex justify-end gap-2' }, [
        h(UButton, {
          to: `/projects/${row.original.id}`,
          size: 'sm',
          variant: 'outline'
        }, () => 'View Details'),
        h(UButton, {
          to: `/projects/${row.original.id}/edit`,
          size: 'sm',
          variant: 'ghost',
          icon: 'i-lucide-pencil'
        }, () => 'Edit')
      ])
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
    </template>
  </UDashboardPanel>
</template>
