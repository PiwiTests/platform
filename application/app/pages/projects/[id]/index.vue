<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import { formatBytes, getFileApiPath } from '~/utils'

interface TestRun {
  id: number
  status: string
  startTime: string
  duration?: number
  totalTests: number
  passedTests: number
  failedTests: number
  skippedTests: number
  flakyTests: number
  reportPath?: string
  reportSize?: number
}

interface Project {
  id: number
  name: string
  description?: string
  testRuns?: TestRun[]
}

const route = useRoute()
const projectId = route.params.id

const { data: project, refresh } = await useFetch<Project>(`/api/projects/${projectId}`)

const UBadge = resolveComponent('UBadge')

function formatDate(date: string | Date) {
  return new Date(date).toLocaleString()
}

function formatDuration(ms?: number | null) {
  if (!ms) return 'N/A'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`
}

function getStatusColor(status: string) {
  switch (status) {
    case 'passed': return 'success'
    case 'failed': return 'error'
    case 'timedout': return 'warning'
    case 'interrupted': return 'warning'
    default: return 'neutral'
  }
}

const runsColumns: TableColumn<TestRun>[] = [
  {
    accessorKey: 'id',
    header: 'Run',
    cell: ({ row }) => {
      return h('a', {
        href: `/test-runs/${row.original.id}`,
        class: 'text-primary hover:underline font-medium',
        onClick: (e: MouseEvent) => {
          e.preventDefault()
          navigateTo(`/test-runs/${row.original.id}`)
        }
      }, `Run #${row.getValue('id')}`)
    }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const color = getStatusColor(row.getValue('status') as string)
      return h(UBadge, { color, class: 'capitalize' }, () => row.getValue('status'))
    }
  },
  {
    accessorKey: 'startTime',
    header: 'Started',
    cell: ({ row }) => formatDate(row.getValue('startTime'))
  },
  {
    accessorKey: 'duration',
    header: 'Duration',
    cell: ({ row }) => formatDuration(row.getValue('duration'))
  },
  {
    accessorKey: 'tests',
    header: 'Tests',
    cell: ({ row }) => {
      const passed = row.original.passedTests
      const failed = row.original.failedTests
      const total = row.original.totalTests
      return h('div', { class: 'flex gap-2 text-sm' }, [
        h('span', { class: 'text-gray-500' }, `Total: ${total}`),
        h('span', { class: 'text-green-600' }, `✓ ${passed}`),
        h('span', { class: 'text-red-600' }, `✗ ${failed}`)
      ])
    }
  },
  {
    accessorKey: 'flakyTests',
    header: 'Flaky',
    cell: ({ row }) => {
      const flaky = row.getValue('flakyTests') as number
      return flaky > 0 ? h('span', { class: 'text-purple-600' }, flaky.toString()) : ''
    }
  },
  {
    accessorKey: 'reportSize',
    header: 'Report',
    cell: ({ row }) => {
      const size = row.getValue('reportSize') as number | undefined
      return size ? formatBytes(size) : ''
    }
  },
  {
    accessorKey: 'actions',
    header: () => h('div', { class: 'text-right' }, 'Actions'),
    cell: ({ row }) => {
      const UButton = resolveComponent('UButton')
      return h('div', { class: 'flex justify-end gap-2' }, [
        h(UButton, {
          to: `/test-runs/${row.original.id}`,
          size: 'sm',
          variant: 'outline'
        }, () => 'View'),
        row.original.reportPath
          ? h(UButton, {
              to: `/api/files/${getFileApiPath(row.original.reportPath)}`,
              target: '_blank',
              size: 'sm',
              variant: 'outline',
              icon: 'i-lucide-external-link'
            }, () => 'Report')
          : null
      ].filter(Boolean))
    }
  }
]
</script>

<template>
  <UDashboardPanel id="project-detail">
    <template #header>
      <UDashboardNavbar :title="project?.name || 'Project Details'">
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
      <div class="p-4 space-y-4">
        <UButton
          to="/projects"
          icon="i-lucide-arrow-left"
          variant="ghost"
          size="sm"
        >
          Back to Projects
        </UButton>

        <!-- Test Runs Trend Chart -->
        <UCard v-if="project?.testRuns && project.testRuns.length > 0">
          <template #header>
            <h2 class="text-xl font-semibold">
              Test Results Trend
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              Test run statistics over time for {{ project?.name }}
            </p>
          </template>

          <TestRunsChart :test-runs="project.testRuns" :height="300" />
        </UCard>

        <UCard>
          <template #header>
            <div class="flex justify-between items-center">
              <h2 class="text-xl font-semibold">
                {{ project?.name }}
              </h2>
              <UButton
                :to="`/projects/${projectId}/test-cases`"
                icon="i-lucide-list-checks"
                size="sm"
                variant="outline"
              >
                View Test Cases
              </UButton>
            </div>
            <p v-if="project?.description" class="text-gray-600 mt-2">
              {{ project.description }}
            </p>
          </template>

          <div class="space-y-4">
            <div>
              <h3 class="text-lg font-medium mb-3">
                Test Runs
              </h3>

              <UTable
                v-if="project?.testRuns && project.testRuns.length > 0"
                :data="project.testRuns"
                :columns="runsColumns"
                :ui="{
                  base: 'table-fixed border-separate border-spacing-0',
                  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                  tbody: '[&>tr]:last:[&>td]:border-b-0',
                  th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                  td: 'border-b border-default'
                }"
              />

              <div v-else class="text-center py-8 text-gray-500">
                No test runs yet for this project.
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
