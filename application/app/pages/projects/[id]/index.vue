<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { ProjectWithTestRuns, TestRunSummary } from '~~/types/api'

const route = useRoute()
const projectId = route.params.id

const { data: project, refresh } = await useFetch<ProjectWithTestRuns>(`/api/projects/${projectId}`)

const UBadge = resolveComponent('UBadge')
const TestStatusBar = resolveComponent('TestStatusBar')
const RunReports = resolveComponent('RunReports')

const runsColumns: TableColumn<TestRunSummary>[] = [
  {
    accessorKey: 'id',
    header: createSortHeader<TestRunSummary>('Run'),
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
    header: createSortHeader<TestRunSummary>('Status'),
    cell: ({ row }) => {
      const color = getStatusColor(row.getValue('status') as string)
      return h(UBadge, { color, class: 'capitalize' }, () => row.getValue('status'))
    }
  },
  {
    accessorKey: 'startTime',
    header: createSortHeader<TestRunSummary>('Started'),
    cell: ({ row }) => formatDate(row.getValue('startTime'))
  },
  {
    accessorKey: 'duration',
    header: createSortHeader<TestRunSummary>('Duration'),
    cell: ({ row }) => formatDuration(row.getValue('duration'))
  },
  {
    accessorKey: 'tests',
    header: 'Test Status',
    cell: ({ row }) => {
      return h(TestStatusBar, {
        passed: row.original.passedTests,
        failed: row.original.failedTests,
        skipped: row.original.skippedTests,
        flaky: row.original.flakyTests,
        total: row.original.totalTests
      })
    }
  },
  {
    accessorKey: 'reports',
    header: 'Reports',
    cell: ({ row }) => h(RunReports, {
      reports: row.original.reports,
      legacyPath: row.original.reportPath,
      legacySize: row.original.reportSize
    })
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
        }, () => 'View')
      ])
    }
  }
]
</script>

<template>
  <UDashboardPanel id="project-detail">
    <template #header>
      <UDashboardNavbar :title="project?.label || project?.name || 'Project Details'">
        <template #trailing>
          <UButton
            :to="`/projects/${projectId}/edit`"
            icon="i-lucide-pencil"
            size="sm"
            variant="outline"
          >
            Edit
          </UButton>
          <UButton
            :to="`/projects/${projectId}/test-cases`"
            icon="i-lucide-list-checks"
            size="sm"
            variant="outline"
          >
            View Test Cases
          </UButton>
          <UButton
            :to="`/projects/${projectId}/performance`"
            icon="i-lucide-gauge"
            size="sm"
            variant="outline"
          >
            Performance
          </UButton>
        </template>
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

        <p v-if="project?.description" class="text-gray-600 mt-2">
          {{ project.description }}
        </p>

        <!-- Test Runs Trend Chart -->
        <UCard v-if="project?.testRuns && project.testRuns.length > 0">
          <template #header>
            <h2>
              Test Results Trend
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              Test run statistics over time for {{ project?.label || project?.name }}
            </p>
          </template>

          <TestRunsChart :test-runs="project.testRuns" :height="300" />
        </UCard>

        <UCard>
          <template #header>
            <h2>
              Test Runs
            </h2>
          </template>
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
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
