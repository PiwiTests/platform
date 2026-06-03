<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { TestCaseWithStats, ProjectDetails } from '~~/types/api'

const route = useRoute()
const projectId = route.params.id

const { data: testCases, refresh } = await useFetch<TestCaseWithStats[]>(`/api/projects/${projectId}/test-cases`)
const { data: project } = await useFetch<ProjectDetails>(`/api/projects/${projectId}`)

useHead(computed(() => ({ title: `${project.value?.label || project.value?.name || 'Project'} — Test cases — Piwi Dashboard` })))

const UBadge = resolveComponent('UBadge')

function getPassRate(testCase: TestCaseWithStats) {
  if (testCase.totalRuns === 0) return 0
  return Math.round((testCase.passedRuns / testCase.totalRuns) * 100)
}

function getTestCaseStatus(testCase: TestCaseWithStats) {
  // Show flaky only if there were flaky runs in the last 10 runs
  const recentFlaky = testCase.recentFlakyRuns ?? testCase.flakyRuns
  if (recentFlaky > 0) {
    return { status: 'flaky', color: 'warning' }
  }
  // Otherwise use last status
  return { status: testCase.lastStatus || 'unknown', color: getStatusColor(testCase.lastStatus || 'unknown') }
}

const testCasesColumns: TableColumn<TestCaseWithStats>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<TestCaseWithStats>('Test case'),
    cell: ({ row }) => {
      return h('div', {}, [
        h('div', { class: 'font-medium' }, row.getValue('title')),
        h('code', { class: 'text-xs bg-gray-100 dark:bg-gray-800 p-1 rounded mt-1 block' }, row.original.filePath)
      ])
    }
  },
  {
    accessorKey: 'status',
    header: createSortHeader<TestCaseWithStats>('Status'),
    cell: ({ row }) => {
      const status = getTestCaseStatus(row.original)
      return h(UBadge, { color: status.color, class: 'capitalize' }, () => status.status)
    }
  },
  {
    accessorKey: 'totalRuns',
    header: createSortHeader<TestCaseWithStats>('Runs'),
    cell: ({ row }) => row.getValue('totalRuns')
  },
  {
    accessorKey: 'passRate',
    header: createSortHeader<TestCaseWithStats>('Pass rate'),
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
    header: createSortHeader<TestCaseWithStats>('Avg duration'),
    cell: ({ row }) => formatDuration(row.getValue('avgDuration'))
  },
  {
    accessorKey: 'lastRun',
    header: createSortHeader<TestCaseWithStats>('Last run'),
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
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project', to: `/projects/${projectId}` },
              { label: 'Test cases' }
            ]"
          />
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
        <UCard>
          <template #header>
            <h2>
              Test cases
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
