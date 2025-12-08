<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'

const route = useRoute()
const projectId = route.params.id

interface TestCaseWithStats {
  id: number
  filePath: string
  title: string
  totalRuns: number
  passedRuns: number
  failedRuns: number
  skippedRuns: number
  timedOutRuns: number
  flakyRuns: number
  avgDuration: number
  lastRun: number
  lastStatus: string
}

interface Project {
  id: number
  name: string
}

const { data: testCases, refresh } = await useFetch<TestCaseWithStats[]>(`/api/projects/${projectId}/test-cases`)
const { data: project } = await useFetch<Project>(`/api/projects/${projectId}`)

const UBadge = resolveComponent('UBadge')

function formatDuration(ms?: number | null) {
  if (!ms) return 'N/A'
  return `${(ms / 1000).toFixed(2)}s`
}

function formatDate(timestamp?: number | null) {
  if (!timestamp) return 'N/A'
  return new Date(timestamp).toLocaleString()
}

function getStatusColor(status: string) {
  switch (status) {
    case 'passed': return 'success'
    case 'failed': return 'error'
    case 'timedout': return 'warning'
    case 'skipped': return 'neutral'
    default: return 'neutral'
  }
}

function getPassRate(testCase: TestCaseWithStats) {
  if (testCase.totalRuns === 0) return 0
  return Math.round((testCase.passedRuns / testCase.totalRuns) * 100)
}

function getTestCaseStatus(testCase: TestCaseWithStats) {
  // If flaky, show as warning
  if (testCase.flakyRuns > 0) {
    return { status: 'flaky', color: 'warning' as const }
  }
  // Otherwise use last status
  return { status: testCase.lastStatus || 'unknown', color: getStatusColor(testCase.lastStatus || 'unknown') }
}

const testCasesColumns: TableColumn<TestCaseWithStats>[] = [
  {
    accessorKey: 'title',
    header: 'Test Case',
    cell: ({ row }) => {
      return h('div', {}, [
        h('div', { class: 'font-medium' }, row.getValue('title')),
        h('code', { class: 'text-xs bg-gray-100 dark:bg-gray-800 p-1 rounded mt-1 block' }, row.original.filePath)
      ])
    }
  },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => {
      const status = getTestCaseStatus(row.original)
      return h(UBadge, { color: status.color, class: 'capitalize' }, () => status.status)
    }
  },
  {
    accessorKey: 'totalRuns',
    header: 'Runs',
    cell: ({ row }) => row.getValue('totalRuns')
  },
  {
    accessorKey: 'passRate',
    header: 'Pass Rate',
    cell: ({ row }) => {
      const passRate = getPassRate(row.original)
      const colorClass = passRate >= 80 ? 'text-green-600' : passRate >= 50 ? 'text-yellow-600' : 'text-red-600'
      return h('span', { class: `font-medium ${colorClass}` }, `${passRate}%`)
    }
  },
  {
    accessorKey: 'results',
    header: 'Results',
    cell: ({ row }) => {
      return h('div', { class: 'flex gap-2 text-sm' }, [
        h('span', { class: 'text-green-600' }, `✓ ${row.original.passedRuns}`),
        h('span', { class: 'text-red-600' }, `✗ ${row.original.failedRuns}`),
        row.original.flakyRuns > 0 ? h('span', { class: 'text-purple-600' }, `↻ ${row.original.flakyRuns}`) : null,
        row.original.skippedRuns > 0 ? h('span', { class: 'text-gray-500' }, `⊘ ${row.original.skippedRuns}`) : null
      ].filter(Boolean))
    }
  },
  {
    accessorKey: 'avgDuration',
    header: 'Avg Duration',
    cell: ({ row }) => formatDuration(row.getValue('avgDuration'))
  },
  {
    accessorKey: 'lastRun',
    header: 'Last Run',
    cell: ({ row }) => {
      const timestamp = row.getValue('lastRun') as number
      return h('span', { class: 'text-xs' }, formatDate(timestamp))
    }
  }
]
</script>

<template>
  <UDashboardPanel id="project-test-cases">
    <template #header>
      <UDashboardNavbar :title="`${project?.name || 'Project'} - Test Cases`">
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
          :to="`/projects/${projectId}`"
          icon="i-lucide-arrow-left"
          variant="ghost"
          size="sm"
        >
          Back to Project
        </UButton>

        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">
              Test Cases
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              All test cases in {{ project?.name }} with statistics across all runs
            </p>
          </template>

          <UTable
            v-if="testCases && testCases.length > 0"
            :data="testCases"
            :columns="testCasesColumns"
            :ui="{
              base: 'table-fixed border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default'
            }"
          />

          <div v-else class="text-center py-8 text-gray-500">
            No test cases yet for this project.
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
