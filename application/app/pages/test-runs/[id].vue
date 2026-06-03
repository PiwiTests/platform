<script setup lang="ts">
import { h, resolveComponent, computed } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { TestRunDetails, TestCaseResult, EndpointSummary, ReportInfo, ProjectWithTestRuns } from '~~/types/api'
import { useRunComparison } from '~/composables/useRunComparison'
import type { ComparisonRow } from '~/composables/useRunComparison'

const route = useRoute()
const runId = route.params.id

const { data: testRun, refresh } = await useFetch<TestRunDetails>(`/api/test-runs/${runId}`)

useHead(computed(() => ({
  title: `Test run #${runId}${testRun.value?.project ? ` — ${testRun.value.project.name}` : ''} — Piwi Dashboard`
})))

const toast = useToast()
const isDeleteConfirmOpen = ref(false)
const deleting = ref(false)

// Live streaming state
const isLive = computed(() => testRun.value?.status === 'running')
const liveTestCases = ref<TestCaseResult[]>([])
// Map of `title@@location` → true for O(1) duplicate detection
const liveTestCaseKeys = new Map<string, true>()
const liveProgress = ref<{ totalTests: number, passedTests: number, failedTests: number, skippedTests: number } | null>(null)
let eventSource: EventSource | null = null

// Connect to SSE when run is in 'running' state
function connectToStream() {
  if (!import.meta.client) return
  if (eventSource) return
  if (!isLive.value) return

  eventSource = new EventSource(`/api/test-runs/${runId}/stream`)

  eventSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data)

      if (parsed.type === 'init') {
        // Initialize live progress with authoritative server-side state
        liveProgress.value = {
          totalTests: parsed.data.totalTests,
          passedTests: parsed.data.passedTests,
          failedTests: parsed.data.failedTests,
          skippedTests: parsed.data.skippedTests
        }
      } else if (parsed.type === 'test-begin') {
        // Add a "running" entry for this test — visible in the dashboard immediately
        const key = `${parsed.data.title}@@${parsed.data.location}`
        if (!liveTestCaseKeys.has(key)) {
          liveTestCaseKeys.set(key, true)
          liveTestCases.value.push({
            id: liveTestCases.value.length + 1,
            title: parsed.data.title,
            status: 'running',
            location: parsed.data.location,
            workerIndex: parsed.data.workerIndex ?? null,
            startedAt: Date.now()
          })
        }
      } else if (parsed.type === 'test-completed') {
        const key = `${parsed.data.title}@@${parsed.data.location}`
        if (liveTestCaseKeys.has(key)) {
          // Update the existing "running" entry with final status
          const idx = liveTestCases.value.findIndex(tc => `${tc.title}@@${tc.location}` === key)
          if (idx >= 0) {
            const tc = liveTestCases.value[idx]!
            tc.status = parsed.data.status
            tc.duration = parsed.data.duration
            tc.error = parsed.data.error
            tc.workerIndex = parsed.data.workerIndex ?? tc.workerIndex
          }
        } else {
          // No test-begin event arrived (e.g. catch-up), add fresh
          liveTestCaseKeys.set(key, true)
          liveTestCases.value.push({
            id: liveTestCases.value.length + 1,
            title: parsed.data.title,
            status: parsed.data.status,
            duration: parsed.data.duration,
            location: parsed.data.location,
            error: parsed.data.error,
            workerIndex: parsed.data.workerIndex ?? null
          })
        }
      } else if (parsed.type === 'run-progress') {
        liveProgress.value = parsed.data
      } else if (parsed.type === 'run-finished') {
        // Run is done — refresh full data from server
        disconnectStream()
        refresh()
      }
    } catch {
      // Ignore parse errors
    }
  }

  eventSource.onerror = () => {
    // EventSource will auto-reconnect
  }
}

function disconnectStream() {
  if (eventSource) {
    eventSource.close()
    eventSource = null
  }
}

// Start streaming connection if run is live
watch(isLive, (live) => {
  if (live) {
    connectToStream()
  } else {
    disconnectStream()
  }
}, { immediate: true })

// Cleanup on unmount
onUnmounted(() => {
  disconnectStream()
})

// Combined test cases: from server data + live stream
const displayTestCases = computed<TestCaseResult[]>(() => {
  if (isLive.value && liveTestCases.value.length > 0) {
    return liveTestCases.value
  }
  return testRun.value?.testCases || []
})

// Elapsed time timer for running tests
const elapsedNow = ref(Date.now())
let elapsedTimer: ReturnType<typeof setInterval> | null = null

function startElapsedTimer() {
  if (elapsedTimer) return
  elapsedTimer = setInterval(() => {
    elapsedNow.value = Date.now()
  }, 1000)
}

function stopElapsedTimer() {
  if (elapsedTimer) {
    clearInterval(elapsedTimer)
    elapsedTimer = null
  }
}

watch(() => displayTestCases.value.some(tc => tc.status === 'running'), (hasRunning) => {
  if (hasRunning) {
    startElapsedTimer()
  } else {
    stopElapsedTimer()
  }
}, { immediate: true })

onUnmounted(() => {
  stopElapsedTimer()
})

// Search and filter state for test cases
const testCaseSearch = ref('')
const testCaseStatusFilter = ref<string>('all')
const testCaseStatusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'Passed', value: 'passed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Skipped', value: 'skipped' },
  { label: 'Flaky', value: 'flaky' }
]

const filteredTestCases = computed<TestCaseResult[]>(() => {
  let cases = displayTestCases.value
  if (testCaseStatusFilter.value !== 'all') {
    cases = cases.filter(tc => tc.status === testCaseStatusFilter.value)
  }
  if (testCaseSearch.value) {
    const query = testCaseSearch.value.toLowerCase()
    cases = cases.filter(tc =>
      tc.title.toLowerCase().includes(query)
      || (tc.location && tc.location.toLowerCase().includes(query))
    )
  }
  return cases
})

// Display progress: live or from loaded data
const displayProgress = computed(() => {
  if (isLive.value && liveProgress.value) {
    return liveProgress.value
  }
  if (!testRun.value) return null
  return {
    totalTests: testRun.value.totalTests,
    passedTests: testRun.value.passedTests,
    failedTests: testRun.value.failedTests,
    skippedTests: testRun.value.skippedTests
  }
})

async function handleDeleteRun() {
  isDeleteConfirmOpen.value = false
  deleting.value = true
  try {
    await $fetch(`/api/test-runs/${runId}`, { method: 'DELETE' })
    toast.add({ title: 'Test run deleted', color: 'success' })
    await navigateTo(`/projects/${testRun.value?.project?.id}`)
  } catch (error: unknown) {
    const errorMessage = error && typeof error === 'object' && 'data' in error
      ? (error.data as { message?: string })?.message
      : undefined
    toast.add({ title: 'Delete failed', description: errorMessage || 'An error occurred', color: 'error' })
  } finally {
    deleting.value = false
  }
}

// Load network requests data lazily (not during SSR) to avoid blocking page load
const { data: networkEndpoints, pending: loadingEndpoints } = await useFetch<EndpointSummary[]>(
  `/api/test-runs/${runId}/network-requests`,
  { lazy: true, server: false }
)

const showCustomData = ref(false)

const UBadge = resolveComponent('UBadge')

// Merge reports from the new `reports` table with the legacy reportPath field
const allReports = computed<ReportInfo[]>(() => {
  if (!testRun.value) return []
  const list: ReportInfo[] = []

  // New reports from the reports table
  if (testRun.value.reports && testRun.value.reports.length > 0) {
    list.push(...testRun.value.reports)
    return list
  }

  // Backward compat: fall back to the legacy reportPath field
  if (testRun.value.reportPath) {
    list.push({
      id: 0,
      type: 'html',
      label: 'HTML Report',
      path: testRun.value.reportPath,
      size: testRun.value.reportSize
    })
  }

  return list
})

// Right panel tabs
const activeTab = ref('test-cases')
const tabItems = [
  { label: 'Test cases', icon: 'i-lucide-beaker', value: 'test-cases' },
  { label: 'Compare', icon: 'i-lucide-git-compare-arrows', value: 'compare' },
  { label: 'Slow endpoints', icon: 'i-lucide-network', value: 'endpoints' }
]

const testCasesColumns: TableColumn<TestCaseResult>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<TestCaseResult>('Test case'),
    cell: ({ row }) => {
      return h('a', {
        href: `/test-cases/${row.original.id}`,
        class: 'text-primary hover:underline font-medium',
        onClick: (e: MouseEvent) => {
          e.preventDefault()
          navigateTo(`/test-cases/${row.original.id}`)
        }
      }, row.getValue('title'))
    }
  },
  {
    accessorKey: 'status',
    header: createSortHeader<TestCaseResult>('Status'),
    cell: ({ row }) => {
      const color = getStatusColor(row.getValue('status') as string)
      return h(UBadge, { color, class: 'capitalize' }, () => row.getValue('status'))
    }
  },
  {
    accessorKey: 'location',
    header: createSortHeader<TestCaseResult>('Location'),
    cell: ({ row }) => {
      const location = row.getValue('location') as string | undefined
      return location ? h('code', { class: 'text-xs' }, location) : ''
    }
  },
  {
    accessorKey: 'duration',
    header: createSortHeader<TestCaseResult>('Duration'),
    cell: ({ row }) => {
      if (row.original.status === 'running' && row.original.startedAt) {
        return formatDuration(Math.max(0, elapsedNow.value - row.original.startedAt))
      }
      return formatDuration(row.getValue('duration'))
    }
  },
  {
    accessorKey: 'workerIndex',
    header: createSortHeader<TestCaseResult>('Worker'),
    cell: ({ row }) => {
      const wi = row.getValue('workerIndex') as number | null | undefined
      if (wi === null || wi === undefined) return ''
      return h(UBadge, { color: 'neutral', variant: 'soft', class: 'font-mono text-xs' }, () => `${wi}`)
    }
  },
  {
    accessorKey: 'slowestStep',
    header: createSortHeader<TestCaseResult>('Slowest step'),
    cell: ({ row }) => {
      const step = row.getValue('slowestStep') as string | null
      const stepDuration = row.original.slowestStepDuration
      if (!step) return ''
      return h('div', { class: 'text-xs' }, [
        h('span', { class: 'text-gray-600 dark:text-gray-400' }, step),
        stepDuration ? h('span', { class: 'ml-1 text-orange-600 font-medium' }, `(${formatDuration(stepDuration)})`) : null
      ].filter(Boolean))
    }
  },
  {
    accessorKey: 'retries',
    header: createSortHeader<TestCaseResult>('Retries'),
    cell: ({ row }) => {
      const retries = row.getValue('retries') as number | undefined
      return retries && retries > 0 ? retries.toString() : ''
    }
  },
  {
    accessorKey: 'actions',
    header: () => h('div', { class: 'text-right' }, 'Actions'),
    cell: ({ row }) => {
      const UButton = resolveComponent('UButton')
      return h('div', { class: 'flex justify-end' },
        h(UButton, {
          to: `/test-cases/${row.original.id}`,
          size: 'sm',
          variant: 'outline'
        }, () => 'View details')
      )
    }
  }
]

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

// ---- Run Comparison Feature ----
interface RunOption {
  label: string
  value: number
}

// Fetch project data to get list of runs for comparison
const { data: projectData } = await useFetch<ProjectWithTestRuns>(() => `/api/projects/${testRun.value?.projectId}`, {
  lazy: true
})

const projectRunOptions = computed<RunOption[]>(() => {
  if (!projectData.value?.testRuns) return []
  return projectData.value.testRuns
    .filter(r => r.id !== Number(runId))
    .slice(0, 50)
    .map(r => ({
      label: `Run #${r.id} — ${new Date(r.startTime).toLocaleDateString()} (${r.status})`,
      value: r.id
    }))
})

// Auto-detect previous run (chronologically previous, not by ID)
const previousRunId = computed<number | null>(() => {
  if (!projectData.value?.testRuns) return null
  const sorted = [...projectData.value.testRuns].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()
  )
  const currentIdx = sorted.findIndex(r => r.id === Number(runId))
  if (currentIdx >= 0 && currentIdx < sorted.length - 1) {
    return sorted[currentIdx + 1]!.id
  }
  return null
})

const compareRunA = ref<RunOption | undefined>(undefined)
const baselineRun = ref<TestRunDetails | null>(null)
const loadingBaseline = ref(false)

watch(compareRunA, async (opt) => {
  if (!opt?.value) {
    baselineRun.value = null
    return
  }
  loadingBaseline.value = true
  try {
    baselineRun.value = await $fetch<TestRunDetails>(`/api/test-runs/${opt.value}`)
  } catch {
    // ignore — keep old baselineRun value
  } finally {
    loadingBaseline.value = false
  }
})

function compareWithPrevious() {
  if (previousRunId.value) {
    const match = projectRunOptions.value.find(o => o.value === previousRunId.value)
    if (match) compareRunA.value = match
  }
}

// This run as the baseline ref for the composable
const currentRunRef = computed<TestRunDetails | null>(() => testRun.value ?? null)
const { comparisonData, comparisonSummary } = useRunComparison(baselineRun, currentRunRef)

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
      return h(resolveComponent('UBadge'), { color, class: 'capitalize' }, () => status)
    }
  },
  {
    accessorKey: 'statusB',
    header: createSortHeader<ComparisonRow>('Status B'),
    cell: ({ row }) => {
      const status = row.getValue('statusB') as string | null
      if (!status) return h('span', { class: 'text-gray-400' }, '—')
      const color = getStatusColor(status)
      return h(resolveComponent('UBadge'), { color, class: 'capitalize' }, () => status)
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
  <UDashboardPanel id="test-run-detail">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              ...(testRun?.project?.id ? [{ label: testRun.project.label || testRun.project.name || 'Project', to: `/projects/${testRun.project.id}` }] : [{ label: 'Project' }]),
              { label: `Test run #${runId}` }
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
          <UButton
            icon="i-lucide-trash-2"
            size="md"
            color="error"
            variant="soft"
            label="Delete"
            :loading="deleting"
            @click="isDeleteConfirmOpen = true"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-3 lg:p-4 space-y-4">
        <!-- ===== COMPACT SUMMARY CARD ===== -->
        <UCard class="shadow-xs">
          <div class="space-y-3">
            <!-- Top header row -->
            <div class="flex items-start justify-between gap-3">
              <div class="flex items-center gap-2.5 min-w-0">
                <div
                  class="shrink-0 size-8 rounded-lg flex items-center justify-center"
                  :class="{
                    'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400': testRun?.status === 'passed',
                    'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400': testRun?.status === 'failed' || testRun?.status === 'timedOut',
                    'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400': testRun?.status === 'cancelled' || testRun?.status === 'skipped',
                    'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400': testRun?.status === 'running' || testRun?.status === 'initialising'
                  }"
                >
                  <UIcon
                    :name="testRun?.status === 'passed' ? 'i-lucide-check-circle-2'
                      : testRun?.status === 'failed' || testRun?.status === 'timedOut' ? 'i-lucide-x-circle'
                        : testRun?.status === 'running' || testRun?.status === 'initialising' ? 'i-lucide-loader-circle'
                          : 'i-lucide-minus-circle'"
                    class="size-4.5"
                    :class="{ 'animate-spin': testRun?.status === 'running' || testRun?.status === 'initialising' }"
                  />
                </div>
                <div class="min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <h2 class="text-base font-bold truncate">
                      Test run #{{ testRun?.id }}
                    </h2>
                    <RunStatusBadge :status="testRun?.status ?? ''" />
                    <span v-if="isLive" class="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400 animate-pulse">
                      <span class="relative flex h-1.5 w-1.5">
                        <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                        <span class="relative inline-flex rounded-full h-1.5 w-1.5 bg-red-500" />
                      </span>
                      Live
                    </span>
                    <span v-if="testRun?.environment" class="text-xs font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-1.5 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">
                      {{ testRun.environment }}
                    </span>
                  </div>
                  <p class="text-xs text-gray-500 mt-0.5">
                    {{ testRun?.project?.label ?? testRun?.project?.name }}
                    &middot;
                    Started {{ testRun?.startTime ? new Date(testRun.startTime).toLocaleString() : 'N/A' }}
                  </p>
                </div>
              </div>
              <div v-if="allReports.length > 0" class="shrink-0 hidden sm:flex items-start gap-2">
                <RunReports :reports="allReports" />
              </div>
            </div>

            <!-- Stat boxes row -->
            <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  Total
                </p>
                <p class="text-xl font-bold mt-0.5">
                  {{ displayProgress?.totalTests ?? testRun?.totalTests ?? 0 }}
                </p>
              </div>
              <div class="rounded-lg bg-green-50 dark:bg-green-900/20 p-3">
                <p class="text-xs font-medium text-green-700 dark:text-green-400 uppercase tracking-wider">
                  <span class="inline-block size-1.5 rounded-full bg-green-500 mr-1 align-middle" />
                  Passed
                </p>
                <p class="text-xl font-bold mt-0.5 text-green-600 dark:text-green-400">
                  {{ displayProgress?.passedTests ?? testRun?.passedTests ?? 0 }}
                </p>
              </div>
              <div class="rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
                <p class="text-xs font-medium text-red-700 dark:text-red-400 uppercase tracking-wider">
                  <span class="inline-block size-1.5 rounded-full bg-red-500 mr-1 align-middle" />
                  Failed
                </p>
                <p class="text-xl font-bold mt-0.5 text-red-600 dark:text-red-400">
                  {{ displayProgress?.failedTests ?? testRun?.failedTests ?? 0 }}
                </p>
              </div>
              <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">
                  <span class="inline-block size-1.5 rounded-full bg-gray-400 mr-1 align-middle" />
                  Skipped
                </p>
                <p class="text-xl font-bold mt-0.5 text-gray-600 dark:text-gray-400">
                  {{ displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0 }}
                </p>
              </div>
            </div>

            <!-- Progress bar row compact -->
            <div>
              <div v-if="testRun" class="flex items-center gap-3">
                <div class="flex-1 max-w-md">
                  <TestStatusBar
                    :passed="displayProgress?.passedTests ?? testRun?.passedTests ?? 0"
                    :failed="displayProgress?.failedTests ?? testRun?.failedTests ?? 0"
                    :skipped="displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0"
                    :flaky="testRun?.flakyTests ?? 0"
                    :total="displayProgress?.totalTests ?? testRun?.totalTests ?? 0"
                  />
                </div>
                <div class="flex items-center gap-3 text-xs shrink-0">
                  <div class="flex items-center gap-1">
                    <UIcon name="i-lucide-clock" class="size-3.5 text-gray-400" />
                    <span class="font-medium tabular-nums">{{ formatDuration(testRun?.duration) }}</span>
                  </div>
                  <div v-if="testRun?.avgTestDuration" class="flex items-center gap-1">
                    <UIcon name="i-lucide-gauge" class="size-3.5 text-gray-400" />
                    <span class="text-gray-500 hidden sm:inline">Avg</span>
                    <span class="font-medium tabular-nums">{{ formatDuration(testRun.avgTestDuration) }}</span>
                  </div>
                  <div v-if="testRun?.p90TestDuration" class="flex items-center gap-1">
                    <UIcon name="i-lucide-arrow-up-right" class="size-3.5 text-orange-500" />
                    <span class="text-gray-500 hidden sm:inline">P90</span>
                    <span class="font-medium tabular-nums text-orange-600 dark:text-orange-400">{{ formatDuration(testRun.p90TestDuration) }}</span>
                  </div>
                </div>
              </div>
              <!-- Live progress bar -->
              <div v-if="isLive && displayProgress" class="mt-2">
                <div class="flex justify-between text-xs text-gray-500 mb-1">
                  <span class="font-medium">Progress</span>
                  <span class="tabular-nums">{{ displayProgress.passedTests + displayProgress.failedTests + displayProgress.skippedTests }} / {{ displayProgress.totalTests || '?' }}</span>
                </div>
                <div class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex">
                  <div
                    v-if="displayProgress.passedTests > 0"
                    class="h-full bg-green-500 transition-all duration-500"
                    :style="{ width: `${(displayProgress.passedTests / Math.max(displayProgress.totalTests || displayProgress.passedTests + displayProgress.failedTests + displayProgress.skippedTests, 1)) * 100}%` }"
                  />
                  <div
                    v-if="displayProgress.failedTests > 0"
                    class="h-full bg-red-500 transition-all duration-500"
                    :style="{ width: `${(displayProgress.failedTests / Math.max(displayProgress.totalTests || displayProgress.passedTests + displayProgress.failedTests + displayProgress.skippedTests, 1)) * 100}%` }"
                  />
                  <div
                    v-if="displayProgress.skippedTests > 0"
                    class="h-full bg-gray-400 transition-all duration-500"
                    :style="{ width: `${(displayProgress.skippedTests / Math.max(displayProgress.totalTests || displayProgress.passedTests + displayProgress.failedTests + displayProgress.skippedTests, 1)) * 100}%` }"
                  />
                </div>
              </div>
            </div>

            <div v-if="allReports.length > 0" class="sm:hidden">
              <p class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                Reports
              </p>
              <RunReports :reports="allReports" />
            </div>
          </div>
        </UCard>

        <!-- ===== METADATA HEADER AREA (tags, SCM, CI, details) ===== -->
        <div
          v-if="testRun?.metadata"
          class="flex flex-wrap items-start gap-x-6 gap-y-2 text-xs text-gray-600 dark:text-gray-400"
        >
          <!-- Tags -->
          <div v-if="testRun.metadata.tags && testRun.metadata.tags.length > 0" class="flex items-center gap-1.5 flex-wrap">
            <UBadge
              v-for="tag in testRun.metadata.tags"
              :key="tag"
              color="gray"
              variant="soft"
              size="sm"
            >
              {{ tag }}
            </UBadge>
          </div>

          <!-- Source control -->
          <template v-if="testRun.metadata.scm">
            <span v-if="testRun.metadata.scm.branch" class="flex items-center gap-1">
              <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0" />
              <span class="font-medium">{{ testRun.metadata.scm.branch }}</span>
            </span>
            <span v-if="testRun.metadata.scm.commit" class="flex items-center gap-1">
              <UIcon name="i-lucide-git-commit-horizontal" class="size-3.5 shrink-0" />
              <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded font-mono text-xs">{{ testRun.metadata.scm.commit.length >= 8 ? testRun.metadata.scm.commit.substring(0, 8) : testRun.metadata.scm.commit }}</code>
            </span>
            <span v-if="testRun.metadata.scm.author" class="flex items-center gap-1">
              <UIcon name="i-lucide-user" class="size-3.5 shrink-0" />
              <span>{{ testRun.metadata.scm.author }}</span>
            </span>
            <span v-if="testRun.metadata.scm.commitMessage" class="text-gray-400 italic truncate max-w-64 hidden sm:inline" :title="testRun.metadata.scm.commitMessage">
              {{ testRun.metadata.scm.commitMessage }}
            </span>
          </template>

          <!-- CI -->
          <template v-if="testRun.metadata.ci">
            <span v-if="testRun.metadata.ci.provider" class="flex items-center gap-1">
              <UIcon name="i-lucide-cloud" class="size-3.5 shrink-0" />
              <span>{{ testRun.metadata.ci.provider }}{{ testRun.metadata.ci.buildNumber ? ` #${testRun.metadata.ci.buildNumber}` : '' }}</span>
            </span>
            <span v-if="testRun.metadata.ci.jobName" class="text-gray-500">
              Job: {{ testRun.metadata.ci.jobName }}
            </span>
            <a
              v-if="testRun.metadata.ci.buildUrl"
              :href="testRun.metadata.ci.buildUrl"
              target="_blank"
              class="text-primary hover:underline inline-flex items-center gap-0.5"
            >
              <UIcon name="i-lucide-external-link" class="size-3" /> Build
            </a>
          </template>

          <!-- Description / Related issue -->
          <span v-if="testRun.metadata.projectDescription" class="text-gray-500 truncate max-w-64 hidden sm:inline">
            {{ testRun.metadata.projectDescription }}
          </span>
          <span v-if="testRun.metadata.relatedIssue" class="flex items-center gap-1">
            <UIcon name="i-lucide-link" class="size-3.5 shrink-0" />
            <span>{{ testRun.metadata.relatedIssue }}</span>
          </span>

          <!-- Custom Data toggle -->
          <UButton
            v-if="testRun.metadata.customData"
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-chevron-down"
            @click="showCustomData = !showCustomData"
          >
            Custom data
          </UButton>
        </div>

        <!-- Custom data expandable -->
        <div v-if="showCustomData && testRun?.metadata?.customData" class="-mt-2">
          <div class="bg-gray-50 dark:bg-gray-900 p-3 rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
            <pre class="m-0">{{ JSON.stringify(testRun.metadata.customData, null, 2) }}</pre>
          </div>
        </div>

        <!-- ===== TABBED CONTENT PANEL ===== -->
        <UCard>
          <template #header>
            <UTabs
              v-model="activeTab"
              :items="tabItems"
              size="sm"
            />
          </template>

          <div class="overflow-y-auto" style="max-height: calc(100vh - 22rem)">
            <!-- Tab: Test cases -->
            <div v-if="activeTab === 'test-cases'">
              <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
                <div class="flex items-center gap-2">
                  <span v-if="isLive" class="text-sm text-gray-500 tabular-nums">
                    {{ displayTestCases.length }} completed
                  </span>
                  <span v-else class="text-sm text-gray-500 tabular-nums">
                    {{ filteredTestCases.length }}{{ filteredTestCases.length !== displayTestCases.length ? ` / ${displayTestCases.length}` : '' }} cases
                  </span>
                </div>
                <div class="flex items-center gap-2">
                  <UInput
                    v-model="testCaseSearch"
                    placeholder="Search test cases..."
                    icon="i-lucide-search"
                    size="sm"
                    class="min-w-48"
                  />
                  <USelect
                    v-model="testCaseStatusFilter"
                    :items="testCaseStatusOptions"
                    size="sm"
                    class="w-32"
                  />
                </div>
              </div>

              <UTable
                v-if="filteredTestCases.length > 0"
                :data="filteredTestCases"
                :columns="testCasesColumns"
                :ui="{
                  base: 'table-fixed border-separate border-spacing-0',
                  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                  tbody: '[&>tr]:last:[&>td]:border-b-0 [&>tr]:hover:bg-gray-50 dark:[&>tr]:hover:bg-gray-900/50',
                  th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                  td: 'border-b border-default'
                }"
              />

              <div v-else-if="displayTestCases.length > 0" class="text-center py-10 text-gray-500">
                <UIcon name="i-lucide-search-x" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p>No test cases match your filters.</p>
              </div>

              <div v-else class="text-center py-10 text-gray-500">
                <UIcon name="i-lucide-beaker" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p>No test cases recorded for this run.</p>
              </div>
            </div>

            <!-- Tab: Compare -->
            <div v-if="activeTab === 'compare'">
              <template v-if="testRun && !isLive">
                <div class="space-y-4">
                  <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run A (baseline)</label>
                      <USelectMenu
                        v-model="compareRunA"
                        :items="projectRunOptions"
                        placeholder="Select a baseline run..."
                      />
                    </div>
                    <div>
                      <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run B (this run)</label>
                      <div class="flex items-center gap-2 py-1.5">
                        <RunStatusBadge :status="testRun.status" />
                        <span class="font-medium">#{{ testRun.id }}</span>
                      </div>
                    </div>
                  </div>

                  <div v-if="previousRunId" class="flex">
                    <UButton
                      icon="i-lucide-arrow-left-right"
                      size="sm"
                      variant="outline"
                      label="Compare with previous run"
                      @click="compareWithPrevious"
                    />
                  </div>

                  <div v-if="loadingBaseline" class="flex items-center justify-center py-6 text-gray-500 gap-2">
                    <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
                    <span>Loading baseline data...</span>
                  </div>

                  <template v-else-if="baselineRun && comparisonData.length > 0">
                    <div class="flex flex-wrap gap-4 text-sm">
                      <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">Status</span>
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
                      <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">Duration</span>
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
                  </template>

                  <div v-else-if="compareRunA && !loadingBaseline" class="text-center py-8 text-gray-500">
                    <UIcon name="i-lucide-git-compare-arrows" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                    <p>No comparison data available.</p>
                  </div>

                  <div v-else class="text-center py-8 text-gray-500">
                    <UIcon name="i-lucide-arrow-left-right" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                    <p>Select a baseline run to compare.</p>
                  </div>
                </div>
              </template>
              <div v-else-if="isLive" class="text-center py-10 text-gray-500">
                <UIcon name="i-lucide-git-compare-arrows" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
                <p>Comparison is available after the run finishes.</p>
              </div>
            </div>

            <!-- Tab: Slow endpoints -->
            <div v-if="activeTab === 'endpoints'">
              <div v-if="loadingEndpoints" class="flex items-center justify-center py-8 text-gray-500 gap-2">
                <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
                <span>Loading network data...</span>
              </div>

              <UTable
                v-else-if="networkEndpoints && networkEndpoints.length > 0"
                :data="networkEndpoints"
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
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>

  <!-- Delete Confirm Dialog -->
  <ClientOnly>
    <UModal :open="isDeleteConfirmOpen" title="Delete test run" @update:open="isDeleteConfirmOpen = $event">
      <template #body>
        <p>
          Are you sure you want to delete <strong>Test Run #{{ testRun?.id }}</strong>?
          This will also remove all associated test results, reports, and traces.
          This action cannot be undone.
        </p>
      </template>
      <template #footer>
        <UButton
          color="neutral"
          variant="ghost"
          label="Cancel"
          @click="isDeleteConfirmOpen = false"
        />
        <UButton
          color="error"
          label="Delete"
          icon="i-lucide-trash-2"
          :loading="deleting"
          @click="handleDeleteRun"
        />
      </template>
    </UModal>
  </ClientOnly>
</template>
