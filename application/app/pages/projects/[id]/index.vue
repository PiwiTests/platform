<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type {
  ProjectWithTestRuns, TestRunSummary,
  TestCaseWithStats,
  PerformanceTrendPoint, SlowTest, TestRunForCompare
} from '~~/types/api'
import { useRunComparison } from '~/composables/useRunComparison'
import type { ComparisonRow } from '~/composables/useRunComparison'

const route = useRoute()
const projectId = route.params.id

// === MAIN PROJECT DATA ===
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

// === TABS ===
const activeTab = ref('test-runs')

// Support ?tab= query param for sidebar/redirect links
const validTabs = ['test-runs', 'failure-clusters', 'trends', 'test-cases', 'compare'] as const
const queryTab = route.query.tab
if (typeof queryTab === 'string' && validTabs.includes(queryTab as typeof validTabs[number])) {
  activeTab.value = queryTab as string
}

const hasFailures = computed(() =>
  project.value?.testRuns?.some(r => r.failedTests > 0) ?? false
)

// Fetch cluster count for tab label
const { data: clustersData } = await useFetch<unknown[]>(`/api/projects/${projectId}/failure-clusters`, { lazy: true })
const clustersCount = computed(() => clustersData.value?.length ?? 0)

const tabItems = computed(() => [
  { label: `Test runs (${filteredRuns.value.length})`, icon: 'i-lucide-play-circle', value: 'test-runs', slot: 'test-runs' },
  ...(hasFailures.value ? [{ label: `Failure clusters (${clustersCount.value})`, icon: 'i-lucide-layers', value: 'failure-clusters', slot: 'failure-clusters' }] : []),
  { label: 'Trends', icon: 'i-lucide-trending-up', value: 'trends', slot: 'trends' },
  { label: `Test cases (${testCases.value?.length ?? 0})`, icon: 'i-lucide-list-checks', value: 'test-cases', slot: 'test-cases' },
  { label: 'Compare', icon: 'i-lucide-git-compare-arrows', value: 'compare', slot: 'compare' }
])

// === TEST RUNS TAB ===
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

// Shared ref for passing selected runs to compare tab
const preSelectedCompareRuns = ref<[number, number] | null>(null)

function compareSelectedRuns() {
  if (selectedRunIds.value.length !== 2) return
  preSelectedCompareRuns.value = [selectedRunIds.value[0]!, selectedRunIds.value[1]!]
  activeTab.value = 'compare'
}

// Environment filter
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
const BrowserBadge = resolveComponent('BrowserBadge')

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
    id: 'browsers',
    accessorFn: (row) => row.browsers,
    header: '',
    cell: ({ row }) => {
      const browsers = row.original.browsers
      if (!browsers?.length) return ''
      return h('div', { class: 'flex items-center gap-1' },
        browsers.map(name => h(BrowserBadge, { browser: { projectName: name }, size: 'sm' }))
      )
    }
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

// === TEST CASES TAB ===
const { data: testCases } = await useFetch<TestCaseWithStats[]>(`/api/projects/${projectId}/test-cases`)

const UBadge = resolveComponent('UBadge')

function getPassRate(testCase: TestCaseWithStats) {
  if (testCase.totalRuns === 0) return 0
  return Math.round((testCase.passedRuns / testCase.totalRuns) * 100)
}

function getTestCaseStatus(testCase: TestCaseWithStats) {
  const recentFlaky = testCase.recentFlakyRuns ?? testCase.flakyRuns
  if (recentFlaky > 0) {
    return { status: 'flaky', color: 'warning' }
  }
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
      return h('span', { class: 'text-xs' }, prettyDateFormat(timestamp))
    }
  }
]

// === TRENDS TAB ===
const dateFrom = ref('')
const dateTo = ref('')

const performanceQueryParams = computed(() => {
  const params: Record<string, string> = {}
  if (dateFrom.value) params.from = dateFrom.value
  if (dateTo.value) params.to = dateTo.value
  return params
})

const { data: performanceData } = await useFetch<PerformanceTrendPoint[]>(
  () => `/api/projects/${projectId}/performance`,
  { query: performanceQueryParams }
)
const { data: slowTests } = await useFetch<SlowTest[]>(`/api/projects/${projectId}/slow-tests`)

const slowTestsColumns: TableColumn<SlowTest>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<SlowTest>('Test case'),
    cell: ({ row }) => {
      return h('div', {}, [
        h('div', { class: 'font-medium' }, row.getValue('title')),
        h('code', { class: 'text-xs bg-gray-100 dark:bg-gray-800 p-1 rounded mt-1 block' }, row.original.filePath)
      ])
    }
  },
  {
    accessorKey: 'avgDuration',
    header: createSortHeader<SlowTest>('Avg duration'),
    cell: ({ row }) => formatDuration(row.getValue('avgDuration'))
  },
  {
    accessorKey: 'maxDuration',
    header: createSortHeader<SlowTest>('Max'),
    cell: ({ row }) => formatDuration(row.getValue('maxDuration'))
  },
  {
    accessorKey: 'minDuration',
    header: createSortHeader<SlowTest>('Min'),
    cell: ({ row }) => formatDuration(row.getValue('minDuration'))
  },
  {
    accessorKey: 'latestDuration',
    header: createSortHeader<SlowTest>('Latest'),
    cell: ({ row }) => formatDuration(row.getValue('latestDuration'))
  },
  {
    accessorKey: 'trend',
    header: createSortHeader<SlowTest>('Trend'),
    cell: ({ row }) => {
      const trend = row.getValue('trend') as string
      if (trend === 'slower') return h('span', { class: 'text-red-600 font-medium' }, '▲ Slower')
      if (trend === 'faster') return h('span', { class: 'text-green-600 font-medium' }, '▼ Faster')
      return h('span', { class: 'text-gray-500' }, '— Stable')
    }
  },
  {
    accessorKey: 'runCount',
    header: createSortHeader<SlowTest>('Runs'),
    cell: ({ row }) => row.getValue('runCount')
  }
]

// === COMPARE TAB ===
function formatRunLabel(run: TestRunSummary): string {
  const date = prettyDateFormat(run.startTime, { dateOnly: true })
  const commitSuffix = (run.metadata?.scm?.commit) ? ` (${run.metadata.scm.commit.substring(0, 7)})` : ''
  return `Run #${run.id} — ${date}${commitSuffix}`
}

interface RunOption {
  label: string
  value: number
}

const runOptions = computed<RunOption[]>(() => {
  if (!project.value?.testRuns) return []
  return [...project.value.testRuns].reverse().map(run => ({
    label: formatRunLabel(run),
    value: run.id
  }))
})

const compareRunA = ref<RunOption | undefined>(undefined)
const compareRunB = ref<RunOption | undefined>(undefined)

// Pre-select from query params (direct links to compare tab)
const queryRunA = computed(() => route.query.runA ? Number(route.query.runA) : null)
const queryRunB = computed(() => route.query.runB ? Number(route.query.runB) : null)

watch(runOptions, (options) => {
  if (queryRunA.value) {
    const match = options.find(o => o.value === queryRunA.value)
    if (match) compareRunA.value = match
  }
  if (queryRunB.value) {
    const match = options.find(o => o.value === queryRunB.value)
    if (match) compareRunB.value = match
  }
}, { immediate: true })

// Watch for pre-selected runs from the test runs tab
watch(preSelectedCompareRuns, (selected) => {
  if (selected) {
    const optA = runOptions.value.find(o => o.value === selected[0])
    const optB = runOptions.value.find(o => o.value === selected[1])
    if (optA) compareRunA.value = optA
    if (optB) compareRunB.value = optB
    preSelectedCompareRuns.value = null
  }
})

function compareLatestWithPrevious() {
  if (runOptions.value.length >= 2) {
    compareRunA.value = runOptions.value[1]
    compareRunB.value = runOptions.value[0]
  }
}

const runADetails = ref<TestRunForCompare | null>(null)
const runBDetails = ref<TestRunForCompare | null>(null)
const compareLoading = ref(false)

async function fetchBothRuns() {
  const optA = compareRunA.value
  const optB = compareRunB.value
  if (!optA?.value && !optB?.value) return
  compareLoading.value = true
  try {
    const ids: number[] = []
    if (optA?.value) ids.push(optA.value)
    if (optB?.value) ids.push(optB.value)
    const results = await Promise.all(
      ids.map(id => $fetch<TestRunForCompare>(`/api/test-runs/${id}/summary`))
    )
    const map = new Map<number, TestRunForCompare>()
    for (const r of results) map.set(r.id, r)
    runADetails.value = optA?.value ? (map.get(optA.value) ?? null) : null
    runBDetails.value = optB?.value ? (map.get(optB.value) ?? null) : null
  } catch {
    runADetails.value = null
    runBDetails.value = null
  } finally {
    compareLoading.value = false
  }
}

watch([compareRunA, compareRunB], () => {
  fetchBothRuns()
})

const { comparisonData, comparisonSummary } = useRunComparison(runADetails, runBDetails)

const comparisonColumns: TableColumn<ComparisonRow>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<ComparisonRow>('Test case'),
    cell: ({ row }) => h('span', { class: 'font-medium' }, row.getValue('title'))
  },
  {
    accessorKey: 'statusA',
    header: createSortHeader<ComparisonRow>('Status A'),
    cell: ({ row }) => {
      const status = row.getValue('statusA') as string | null
      if (!status) return h('span', { class: 'text-gray-400' }, '—')
      const color = getStatusColor(status)
      return h(UBadge, { color, class: 'capitalize' }, () => status)
    }
  },
  {
    accessorKey: 'statusB',
    header: createSortHeader<ComparisonRow>('Status B'),
    cell: ({ row }) => {
      const status = row.getValue('statusB') as string | null
      if (!status) return h('span', { class: 'text-gray-400' }, '—')
      const color = getStatusColor(status)
      return h(UBadge, { color, class: 'capitalize' }, () => status)
    }
  },
  {
    accessorKey: 'durationA',
    header: createSortHeader<ComparisonRow>('Duration A'),
    cell: ({ row }) => {
      const val = row.getValue('durationA') as number | null
      return val !== null ? formatDuration(val) : h('span', { class: 'text-gray-400' }, '—')
    }
  },
  {
    accessorKey: 'durationB',
    header: createSortHeader<ComparisonRow>('Duration B'),
    cell: ({ row }) => {
      const val = row.getValue('durationB') as number | null
      return val !== null ? formatDuration(val) : h('span', { class: 'text-gray-400' }, '—')
    }
  },
  {
    accessorKey: 'delta',
    header: createSortHeader<ComparisonRow>('Delta'),
    cell: ({ row }) => {
      const delta = row.getValue('delta') as number | null
      if (delta === null) return h('span', { class: 'text-gray-400' }, '—')
      const sign = delta > 0 ? '+' : ''
      const color = delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-500'
      return h('span', { class: color }, `${sign}${formatDuration(delta)}`)
    }
  },
  {
    accessorKey: 'percentChange',
    header: createSortHeader<ComparisonRow>('Change'),
    cell: ({ row }) => {
      const pct = row.getValue('percentChange') as number | null
      if (pct === null) return h('span', { class: 'text-gray-400' }, '—')
      const sign = pct > 0 ? '+' : ''
      const color = pct > 10 ? 'text-red-600 font-medium' : pct < -10 ? 'text-green-600 font-medium' : 'text-gray-500'
      return h('span', { class: color }, `${sign}${pct}%`)
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
            icon="i-lucide-refresh-cw"
            size="md"
            label="Refresh"
            @click="() => refresh()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col h-full overflow-y-auto gap-4 p-1">
        <div v-if="project?.description || project?.tags && project.tags.length > 0" class="p-4 pb-0 space-y-4">
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
        </div>

        <UTabs
          v-model="activeTab"
          :items="tabItems"
          size="sm"
          class="shrink-0 px-4"
        >
          <!-- TEST RUNS TAB -->
          <template #test-runs>
            <div class="space-y-4 pt-4 px-4">
              <UCard v-if="project?.testRuns && project.testRuns.length > 0">
                <template #header>
                  <p class="text-sm text-gray-600 mt-1">
                    Test run statistics over time for {{ project?.label || project?.name }}
                  </p>
                </template>

                <TestRunsChart :test-runs="project.testRuns" :height="300" />
              </UCard>

              <UCard>
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
                    v-if="selectedRunIds.length === 2"
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

          <!-- FAILURE CLUSTERS TAB -->
          <template #failure-clusters>
            <div class="space-y-4 pt-4 px-4">
              <FailureClustersList :project-id="String(projectId)" />
            </div>
          </template>

          <!-- TRENDS TAB -->
          <template #trends>
            <div class="space-y-6 pt-4 px-4">
              <div class="flex flex-wrap items-center gap-3">
                <span class="text-sm text-muted shrink-0">Date range:</span>
                <UInput
                  v-model="dateFrom"
                  type="date"
                  size="sm"
                  placeholder="From"
                  class="w-40"
                />
                <span class="text-sm text-muted">to</span>
                <UInput
                  v-model="dateTo"
                  type="date"
                  size="sm"
                  placeholder="To"
                  class="w-40"
                />
                <UButton
                  v-if="dateFrom || dateTo"
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-x"
                  label="Clear"
                  @click="dateFrom = ''; dateTo = ''"
                />
              </div>

              <UCard>
                <template #header>
                  <p class="text-sm text-gray-600">
                    Duration metrics over time
                  </p>
                </template>

                <PerformanceTrendChart :data="performanceData || []" :height="350" />
              </UCard>

              <UCard>
                <template #header>
                  <p class="text-sm text-gray-600">
                    Top 20 slowest test cases across recent runs
                  </p>
                </template>

                <UTable
                  v-if="slowTests && slowTests.length > 0"
                  :data="slowTests"
                  :columns="slowTestsColumns"
                  :ui="{
                    base: 'table-fixed border-separate border-spacing-0',
                    thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                    tbody: '[&>tr]:last:[&>td]:border-b-0',
                    th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                    td: 'border-b border-default'
                  }"
                />

                <div v-else class="text-center py-8 text-gray-500">
                  No slow test data available yet.
                </div>
              </UCard>
            </div>
          </template>

          <!-- TEST CASES TAB -->
          <template #test-cases>
            <div class="space-y-4 pt-4 px-4">
              <UCard>
                <template #header>
                  <p class="text-sm text-gray-600">
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

          <!-- COMPARE TAB -->
          <template #compare>
            <div class="space-y-4 pt-4 px-4">
              <UCard>
                <template #header>
                  <div class="flex items-center justify-between">
                    <p class="text-sm text-gray-600">
                      Compare two test runs side-by-side — status changes and duration deltas
                    </p>
                    <UButton
                      v-if="runOptions.length >= 2"
                      icon="i-lucide-git-compare-arrows"
                      size="sm"
                      variant="outline"
                      label="Latest vs previous"
                      @click="compareLatestWithPrevious"
                    />
                  </div>
                </template>

                <div class="space-y-4">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run A (baseline)</label>
                      <USelectMenu
                        v-model="compareRunA"
                        :items="runOptions"
                        placeholder="Select run A..."
                      />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run B (comparison)</label>
                      <USelectMenu
                        v-model="compareRunB"
                        :items="runOptions"
                        placeholder="Select run B..."
                      />
                    </div>
                  </div>

                  <!-- Loading -->
                  <div v-if="compareLoading" class="text-center py-8 text-gray-500">
                    <UIcon name="i-lucide-loader-2" class="animate-spin mr-2" />
                    Loading run data…
                  </div>

                  <!-- Comparison results -->
                  <div v-else-if="compareRunA && compareRunB && comparisonData.length > 0" class="space-y-4">
                    <div class="space-y-2">
                      <div class="flex flex-wrap gap-4 text-sm">
                        <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">Status changes</span>
                        <UBadge
                          v-if="comparisonSummary.newFailures > 0"
                          color="error"
                          variant="soft"
                          size="lg"
                        >
                          {{ comparisonSummary.newFailures }} new failure{{ comparisonSummary.newFailures > 1 ? 's' : '' }}
                        </UBadge>
                        <UBadge
                          v-if="comparisonSummary.recovered > 0"
                          color="success"
                          variant="soft"
                          size="lg"
                        >
                          {{ comparisonSummary.recovered }} recovered
                        </UBadge>
                        <UBadge
                          v-if="comparisonSummary.stillFailing > 0"
                          color="warning"
                          variant="soft"
                          size="lg"
                        >
                          {{ comparisonSummary.stillFailing }} still failing
                        </UBadge>
                        <span v-if="comparisonSummary.newFailures === 0 && comparisonSummary.recovered === 0 && comparisonSummary.stillFailing === 0" class="text-sm text-gray-500">No status changes</span>
                      </div>
                      <div class="flex flex-wrap gap-4 text-sm">
                        <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">Duration changes</span>
                        <UBadge
                          v-if="comparisonSummary.regressed > 0"
                          color="error"
                          variant="soft"
                          size="lg"
                        >
                          {{ comparisonSummary.regressed }} regressed
                        </UBadge>
                        <UBadge
                          v-if="comparisonSummary.improved > 0"
                          color="success"
                          variant="soft"
                          size="lg"
                        >
                          {{ comparisonSummary.improved }} improved
                        </UBadge>
                        <UBadge color="neutral" variant="soft" size="lg">
                          {{ comparisonSummary.unchanged }} unchanged
                        </UBadge>
                      </div>
                    </div>

                    <UTable
                      :data="comparisonData"
                      :columns="comparisonColumns"
                      :ui="{
                        base: 'table-fixed border-separate border-spacing-0',
                        thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                        tbody: '[&>tr]:last:[&>td]:border-b-0',
                        th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                        td: 'border-b border-default'
                      }"
                    />
                  </div>

                  <div v-else-if="!compareRunA || !compareRunB" class="text-center py-8 text-gray-500">
                    Select two runs to compare test results.
                  </div>

                  <div v-else class="text-center py-8 text-gray-500">
                    No overlapping test cases found between the selected runs.
                  </div>
                </div>
              </UCard>
            </div>
          </template>
        </UTabs>
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
