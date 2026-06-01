<script setup lang="ts">
import { h, resolveComponent, computed } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { TestRunDetails, TestCaseResult, EndpointSummary, ReportInfo } from '~~/types/api'

const route = useRoute()
const runId = route.params.id

const { data: testRun, refresh } = await useFetch<TestRunDetails>(`/api/test-runs/${runId}`)

useHead(computed(() => ({
  title: `Test run #${runId}${testRun.value?.project ? ` — ${testRun.value.project.name}` : ''} — Playwright Dashboard`
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
      } else if (parsed.type === 'test-completed') {
        // Avoid duplicates using O(1) Map lookup (catch-up events have seq 0)
        const key = `${parsed.data.title}@@${parsed.data.location}`
        if (!liveTestCaseKeys.has(key)) {
          liveTestCaseKeys.set(key, true)
          liveTestCases.value.push({
            id: liveTestCases.value.length + 1,
            title: parsed.data.title,
            status: parsed.data.status,
            duration: parsed.data.duration,
            location: parsed.data.location,
            error: parsed.data.error
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
    cell: ({ row }) => formatDuration(row.getValue('duration'))
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
      <div class="p-4 space-y-4">
        <UCard>
          <template #header>
            <div class="flex justify-between items-center">
              <div class="flex items-center gap-2">
                <h2 class="text-xl font-semibold">
                  Test run #{{ testRun?.id }}
                </h2>
                <span v-if="isLive" class="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400">
                  <span class="relative flex h-2 w-2">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                    <span class="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
                  </span>
                  Live
                </span>
              </div>
              <UBadge v-if="testRun" :color="getStatusColor(testRun.status)" size="lg">
                {{ testRun.status }}
              </UBadge>
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p class="text-sm text-gray-500">
                  Project
                </p>
                <p class="font-medium">
                  {{ testRun?.project?.label ?? testRun?.project?.name }}
                </p>
              </div>
              <div>
                <p class="text-sm text-gray-500">
                  Total tests
                </p>
                <p class="font-medium">
                  {{ displayProgress?.totalTests ?? testRun?.totalTests }}
                </p>
              </div>
              <div>
                <p class="text-sm text-gray-500">
                  Passed
                </p>
                <p class="font-medium text-green-600">
                  {{ displayProgress?.passedTests ?? testRun?.passedTests }}
                </p>
              </div>
              <div>
                <p class="text-sm text-gray-500">
                  Failed
                </p>
                <p class="font-medium text-red-600">
                  {{ displayProgress?.failedTests ?? testRun?.failedTests }}
                </p>
              </div>
              <div>
                <p class="text-sm text-gray-500">
                  Skipped
                </p>
                <p class="font-medium">
                  {{ displayProgress?.skippedTests ?? testRun?.skippedTests }}
                </p>
              </div>
              <div>
                <p class="text-sm text-gray-500">
                  Duration
                </p>
                <p class="font-medium">
                  {{ formatDuration(testRun?.duration) }}
                </p>
              </div>
              <div v-if="testRun?.avgTestDuration">
                <p class="text-sm text-gray-500">
                  Avg test duration
                </p>
                <p class="font-medium">
                  {{ formatDuration(testRun.avgTestDuration) }}
                </p>
              </div>
              <div v-if="testRun?.p90TestDuration">
                <p class="text-sm text-gray-500">
                  P90 test duration
                </p>
                <p class="font-medium text-orange-600">
                  {{ formatDuration(testRun.p90TestDuration) }}
                </p>
              </div>
              <div>
                <p class="text-sm text-gray-500">
                  Start time
                </p>
                <p class="font-medium">
                  {{ testRun?.startTime ? new Date(testRun.startTime).toLocaleString() : 'N/A' }}
                </p>
              </div>
              <div v-if="testRun?.environment">
                <p class="text-sm text-gray-500">
                  Environment
                </p>
                <p class="font-medium">
                  <span class="text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200 px-1.5 py-0.5 rounded">
                    {{ testRun.environment }}
                  </span>
                </p>
              </div>
            </div>

            <div v-if="allReports.length > 0" class="pt-4 border-t">
              <p class="text-sm text-gray-500 mb-2">
                Reports
              </p>
              <RunReports :reports="allReports" />
            </div>

            <!-- Metadata Section -->
            <div v-if="testRun?.metadata" class="pt-4 border-t">
              <p class="text-sm text-gray-500 mb-3">
                Metadata
              </p>
              <div class="space-y-3">
                <!-- Project Description -->
                <div v-if="testRun.metadata.projectDescription">
                  <p class="text-xs text-gray-500 uppercase">
                    Description
                  </p>
                  <p class="text-sm">
                    {{ testRun.metadata.projectDescription }}
                  </p>
                </div>

                <!-- Related Issue -->
                <div v-if="testRun.metadata.relatedIssue">
                  <p class="text-xs text-gray-500 uppercase">
                    Related issue
                  </p>
                  <p class="text-sm">
                    {{ testRun.metadata.relatedIssue }}
                  </p>
                </div>

                <!-- CI Info -->
                <div v-if="testRun.metadata.ci" class="space-y-2">
                  <p class="text-xs text-gray-500 uppercase">
                    CI information
                  </p>
                  <div class="grid grid-cols-2 gap-2 text-sm">
                    <div v-if="testRun.metadata.ci.provider">
                      <span class="text-gray-500">Provider:</span>
                      <span class="ml-2 font-medium">{{ testRun.metadata.ci.provider }}</span>
                    </div>
                    <div v-if="testRun.metadata.ci.buildNumber">
                      <span class="text-gray-500">Build:</span>
                      <span class="ml-2 font-medium">{{ testRun.metadata.ci.buildNumber }}</span>
                    </div>
                    <div v-if="testRun.metadata.ci.buildUrl" class="col-span-2">
                      <a :href="testRun.metadata.ci.buildUrl" target="_blank" class="text-primary hover:underline flex items-center gap-1">
                        <span>View Build</span>
                        <UIcon name="i-lucide-external-link" class="w-3 h-3" />
                      </a>
                    </div>
                    <div v-if="testRun.metadata.ci.jobName">
                      <span class="text-gray-500">Job:</span>
                      <span class="ml-2 font-medium">{{ testRun.metadata.ci.jobName }}</span>
                    </div>
                    <div v-if="testRun.metadata.ci.workflow">
                      <span class="text-gray-500">Workflow:</span>
                      <span class="ml-2 font-medium">{{ testRun.metadata.ci.workflow }}</span>
                    </div>
                  </div>
                </div>

                <!-- SCM Info -->
                <div v-if="testRun.metadata.scm" class="space-y-2">
                  <p class="text-xs text-gray-500 uppercase">
                    Source control
                  </p>
                  <div class="space-y-1 text-sm">
                    <div v-if="testRun.metadata.scm.commit">
                      <span class="text-gray-500">Commit:</span>
                      <code class="ml-2 text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">{{ testRun.metadata.scm.commit.length >= 8 ? testRun.metadata.scm.commit.substring(0, 8) : testRun.metadata.scm.commit }}</code>
                    </div>
                    <div v-if="testRun.metadata.scm.branch">
                      <span class="text-gray-500">Branch:</span>
                      <span class="ml-2 font-medium">{{ testRun.metadata.scm.branch }}</span>
                    </div>
                    <div v-if="testRun.metadata.scm.author">
                      <span class="text-gray-500">Author:</span>
                      <span class="ml-2 font-medium">{{ testRun.metadata.scm.author }}</span>
                    </div>
                    <div v-if="testRun.metadata.scm.commitMessage">
                      <span class="text-gray-500">Message:</span>
                      <span class="ml-2">{{ testRun.metadata.scm.commitMessage }}</span>
                    </div>
                  </div>
                </div>

                <!-- Tags -->
                <div v-if="testRun.metadata.tags && testRun.metadata.tags.length > 0">
                  <p class="text-xs text-gray-500 uppercase mb-2">
                    Tags
                  </p>
                  <div class="flex flex-wrap gap-2">
                    <UBadge
                      v-for="tag in testRun.metadata.tags"
                      :key="tag"
                      color="gray"
                      variant="soft"
                    >
                      {{ tag }}
                    </UBadge>
                  </div>
                </div>

                <!-- Custom Data -->
                <div v-if="testRun.metadata.customData">
                  <p class="text-xs text-gray-500 uppercase mb-2">
                    Custom data
                  </p>
                  <div class="bg-gray-50 dark:bg-gray-900 p-3 rounded text-xs font-mono overflow-x-auto">
                    <pre>{{ JSON.stringify(testRun.metadata.customData, null, 2) }}</pre>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <h3 class="text-lg font-medium">
                Test cases
              </h3>
              <span v-if="isLive" class="text-sm text-gray-500">
                ({{ displayTestCases.length }} completed)
              </span>
              <span v-else-if="filteredTestCases.length !== displayTestCases.length" class="text-sm text-gray-500">
                ({{ filteredTestCases.length }} of {{ displayTestCases.length }})
              </span>
            </div>

            <!-- Search and filter controls -->
            <div class="flex flex-wrap items-center gap-3 mt-3">
              <UInput
                v-model="testCaseSearch"
                placeholder="Search test cases..."
                icon="i-lucide-search"
                size="sm"
                class="w-64"
              />
              <USelect
                v-model="testCaseStatusFilter"
                :items="testCaseStatusOptions"
                size="sm"
                class="w-40"
              />
            </div>
          </template>

          <!-- Live progress bar -->
          <div v-if="isLive && displayProgress" class="mb-4">
            <div class="flex justify-between text-xs text-gray-500 mb-1">
              <span>Progress</span>
              <span>{{ displayProgress.passedTests + displayProgress.failedTests + displayProgress.skippedTests }} tests completed</span>
            </div>
            <div class="w-full h-2 bg-gray-200 dark:bg-gray-700 rounded-full overflow-hidden flex">
              <div
                v-if="displayProgress.passedTests > 0"
                class="h-full bg-green-500 transition-all duration-300"
                :style="{ width: `${(displayProgress.passedTests / Math.max(displayProgress.totalTests || displayProgress.passedTests + displayProgress.failedTests + displayProgress.skippedTests, 1)) * 100}%` }"
              />
              <div
                v-if="displayProgress.failedTests > 0"
                class="h-full bg-red-500 transition-all duration-300"
                :style="{ width: `${(displayProgress.failedTests / Math.max(displayProgress.totalTests || displayProgress.passedTests + displayProgress.failedTests + displayProgress.skippedTests, 1)) * 100}%` }"
              />
              <div
                v-if="displayProgress.skippedTests > 0"
                class="h-full bg-gray-400 transition-all duration-300"
                :style="{ width: `${(displayProgress.skippedTests / Math.max(displayProgress.totalTests || displayProgress.passedTests + displayProgress.failedTests + displayProgress.skippedTests, 1)) * 100}%` }"
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
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default'
            }"
          />

          <div v-else-if="displayTestCases.length > 0" class="text-center py-8 text-gray-500">
            No test cases match your filters.
          </div>

          <div v-else class="text-center py-8 text-gray-500">
            No test cases recorded for this run.
          </div>
        </UCard>

        <!-- Slow API Endpoints -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-network" class="w-5 h-5 text-primary" />
              <div>
                <h3 class="text-lg font-medium">
                  Slow API endpoints
                </h3>
                <p class="text-sm text-gray-500 mt-0.5">
                  Network requests grouped by route and HTTP method — requires
                  <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">@phenx/playwright-dashboard-reporter/fixtures</code>
                </p>
              </div>
            </div>
          </template>

          <div v-if="loadingEndpoints" class="text-center py-8 text-gray-500">
            <UIcon name="i-lucide-loader-2" class="animate-spin mr-2" />
            Loading…
          </div>

          <UTable
            v-else-if="networkEndpoints && networkEndpoints.length > 0"
            :data="networkEndpoints"
            :columns="endpointColumns"
            :ui="{
              base: 'table-fixed border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default'
            }"
          />

          <div v-else class="text-center py-8 text-gray-500">
            No network request data. Add the
            <code class="text-xs bg-gray-100 dark:bg-gray-800 px-1 rounded">@phenx/playwright-dashboard-reporter/fixtures</code>
            to your Playwright config to start collecting endpoint timing.
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
