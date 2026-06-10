<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { ProjectWithTestRuns, TestRunSummary } from '~~/types/api'

const route = useRoute()
const projectId = route.params.id

const { data: project, refresh } = await useFetch<ProjectWithTestRuns>(`/api/projects/${projectId}`)

useHead(computed(() => ({ title: `${project.value?.label || project.value?.name || 'Project'} — Piwi Dashboard` })))

const toast = useToast()
const deletingRunId = ref<number | null>(null)
const confirmDeleteRunId = ref<number | null>(null)

useRunStream(refresh)

async function handleDeleteRun(runId: number) {
  confirmDeleteRunId.value = null
  deletingRunId.value = runId
  try {
    await $fetch(`/api/test-runs/${runId}`, { method: 'DELETE' })
    toast.add({ title: 'Test run deleted', color: 'success' })
    await refresh()
  } catch (error: unknown) {
    const errorMessage = error && typeof error === 'object' && 'data' in error
      ? (error.data as { message?: string })?.message
      : undefined
    toast.add({ title: 'Delete failed', description: errorMessage || 'An error occurred', color: 'error' })
  } finally {
    deletingRunId.value = null
  }
}

// Run selection for comparison
const selectedRunIds = ref<number[]>([])

const isRunSelected = (runId: number) => selectedRunIds.value.includes(runId)

function toggleRunSelection(runId: number) {
  const idx = selectedRunIds.value.indexOf(runId)
  if (idx >= 0) {
    selectedRunIds.value.splice(idx, 1)
  } else {
    if (selectedRunIds.value.length >= 2) {
      toast.add({ title: 'Maximum 2 runs', description: 'Select at most 2 runs to compare. Deselect one first.', color: 'warning' })
      return
    }
    selectedRunIds.value.push(runId)
  }
}

const compareEnabled = computed(() => selectedRunIds.value.length === 2)

function compareSelectedRuns() {
  if (selectedRunIds.value.length !== 2) return
  navigateTo(`/projects/${projectId}/compare?runA=${selectedRunIds.value[0]}&runB=${selectedRunIds.value[1]}`)
}

// Environment filter state
const selectedEnvironments = ref<string[]>([])

const availableEnvironments = computed(() => {
  const envs = new Set<string>()
  for (const run of project.value?.testRuns || []) {
    if (run.environment) envs.add(run.environment)
  }
  return [...envs].sort()
})

function toggleEnvironmentFilter(env: string) {
  const idx = selectedEnvironments.value.indexOf(env)
  if (idx === -1) {
    selectedEnvironments.value.push(env)
  } else {
    selectedEnvironments.value.splice(idx, 1)
  }
}

function isEnvironmentFilterActive(env: string) {
  return selectedEnvironments.value.includes(env)
}

const filteredRuns = computed(() => {
  const runs = project.value?.testRuns || []
  if (selectedEnvironments.value.length === 0) return runs
  return runs.filter(r => r.environment && selectedEnvironments.value.includes(r.environment))
})

const RunStatusBadge = resolveComponent('RunStatusBadge')
const TestStatusBar = resolveComponent('TestStatusBar')
const RunReports = resolveComponent('RunReports')

const runsColumns: TableColumn<TestRunSummary>[] = [
  {
    accessorKey: 'select',
    header: '',
    cell: ({ row }) => {
      const runId = row.original.id
      const checked = isRunSelected(runId)
      return h('input', {
        type: 'checkbox',
        checked,
        class: 'cursor-pointer size-4 accent-primary',
        onClick: (e: MouseEvent) => {
          e.stopPropagation()
          toggleRunSelection(runId)
        }
      })
    }
  },
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
    cell: ({ row }) => h(RunStatusBadge, { status: row.getValue('status') as string })
  },
  {
    accessorKey: 'startTime',
    header: createSortHeader<TestRunSummary>('Started'),
    cell: ({ row }) => prettyDateFormat(row.getValue('startTime'))
  },
  {
    accessorKey: 'environment',
    header: createSortHeader<TestRunSummary>('Environment'),
    cell: ({ row }) => {
      const env = row.original.environment
      if (!env) return ''
      return h('span', { class: 'text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-1.5 py-0.5 rounded' }, env)
    }
  },
  {
    accessorKey: 'metadata',
    header: 'Branch / Commit',
    cell: ({ row }) => {
      const metadata = row.original.metadata
      if (!metadata?.scm) return ''
      const parts: ReturnType<typeof h>[] = []
      if (metadata.scm.branch) {
        parts.push(h('span', { class: 'text-xs font-medium bg-gray-100 dark:bg-gray-800 px-1.5 py-0.5 rounded' }, metadata.scm.branch))
      }
      if (metadata.scm.commit) {
        parts.push(h('code', { class: 'text-xs text-gray-500 ml-1' }, metadata.scm.commit.substring(0, 7)))
      }
      return h('div', { class: 'flex items-center gap-1 flex-wrap' }, parts)
    }
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
      reports: row.original.reports
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
        }, () => 'View'),
        h(UButton, {
          size: 'sm',
          color: 'error',
          variant: 'soft',
          icon: 'i-lucide-trash-2',
          loading: deletingRunId.value === row.original.id,
          onClick: () => {
            confirmDeleteRunId.value = row.original.id
          }
        }, () => 'Delete')
      ])
    }
  }
]
</script>

<template>
  <UDashboardPanel id="project-detail">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project' }
            ]"
          />
        </template>
        <template #right>
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
            View test cases
          </UButton>
          <UButton
            :to="`/projects/${projectId}/performance`"
            icon="i-lucide-gauge"
            size="sm"
            variant="outline"
          >
            Performance
          </UButton>
          <UButton
            :to="`/projects/${projectId}/compare`"
            icon="i-lucide-git-compare-arrows"
            size="sm"
            variant="outline"
          >
            Compare runs
          </UButton>
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
        <p v-if="project?.description" class="text-gray-600 mt-2">
          {{ project.description }}
        </p>

        <div v-if="project?.tags && project.tags.length > 0" class="flex flex-wrap gap-1 mt-2">
          <TagBadge
            v-for="tag in project.tags"
            :key="tag.id"
            :text="tag.text"
            :color="tag.color"
          />
        </div>

        <!-- Failure clusters (only when the project has failed runs) -->
        <FailureClustersList
          v-if="project?.testRuns?.some(r => r.failedTests > 0)"
          :project-id="String(projectId)"
        />

        <!-- Test Runs Trend Chart -->
        <UCard v-if="project?.testRuns && project.testRuns.length > 0">
          <template #header>
            <h2>
              Test results trend
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
              Test runs
            </h2>
          </template>

          <!-- Environment filter -->
          <div v-if="availableEnvironments.length > 0" class="flex flex-wrap items-center gap-2 mb-4">
            <span class="text-sm text-muted shrink-0">Filter by environment:</span>
            <button
              v-for="env in availableEnvironments"
              :key="env"
              type="button"
              :class="[
                'text-xs font-medium px-2 py-1 rounded border cursor-pointer focus:outline-none transition-colors',
                isEnvironmentFilterActive(env)
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 border-blue-300 dark:border-blue-700 hover:bg-blue-200 dark:hover:bg-blue-800'
              ]"
              @click="toggleEnvironmentFilter(env)"
            >
              {{ env }}
            </button>
            <UButton
              v-if="selectedEnvironments.length > 0"
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-x"
              label="Clear filter"
              @click="selectedEnvironments = []"
            />
          </div>

          <!-- Comparison action bar -->
          <div
            v-if="selectedRunIds.length > 0"
            class="flex items-center gap-3 px-3 py-2 mb-3 rounded-lg bg-primary-50 dark:bg-primary-900/20 border border-primary-200 dark:border-primary-800"
          >
            <span class="text-sm text-primary-700 dark:text-primary-300">
              {{ selectedRunIds.length }} run{{ selectedRunIds.length > 1 ? 's' : '' }} selected
            </span>
            <UButton
              v-if="compareEnabled"
              icon="i-lucide-git-compare-arrows"
              size="sm"
              color="primary"
              label="Compare selected runs"
              @click="compareSelectedRuns"
            />
            <span v-else class="text-xs text-primary-500">
              Select another run to compare
            </span>
            <UButton
              size="xs"
              variant="ghost"
              color="neutral"
              icon="i-lucide-x"
              label="Clear"
              @click="selectedRunIds = []"
            />
          </div>

          <UTable
            v-if="filteredRuns.length > 0"
            :data="filteredRuns"
            :columns="runsColumns"
            :ui="{
              base: 'table-fixed border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default'
            }"
          />

          <div v-else-if="project?.testRuns && project.testRuns.length > 0" class="text-center py-8 text-gray-500">
            No test runs match the selected environment filter.
          </div>

          <div v-else class="text-center py-8 text-gray-500">
            No test runs yet for this project.
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <!-- Delete Run Confirm Dialog -->
  <ClientOnly>
    <UModal
      :open="confirmDeleteRunId !== null"
      title="Delete test run"
      @update:open="val => { if (!val) confirmDeleteRunId = null }"
    >
      <template #body>
        <p>
          Are you sure you want to delete <strong>Run #{{ confirmDeleteRunId }}</strong>?
          This will also remove all associated test results, reports, and traces.
          This action cannot be undone.
        </p>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="confirmDeleteRunId = null"
        />
        <UButton
          color="error"
          label="Delete"
          icon="i-lucide-trash-2"
          :loading="deletingRunId === confirmDeleteRunId"
          @click="handleDeleteRun(confirmDeleteRunId!)"
        />
      </template>
    </UModal>
  </ClientOnly>
</template>
