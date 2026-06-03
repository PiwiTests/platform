<script setup lang="ts">
import { computed, nextTick, watch, onUnmounted } from 'vue'
import type { TestRunDetails, TestCaseResult, EndpointSummary, ReportInfo, ProjectWithTestRuns } from '~~/types/api'
import { useRunComparison } from '~/composables/useRunComparison'

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
const liveTestCaseKeys = new Map<string, true>()
const liveProgress = ref<{ totalTests: number, passedTests: number, failedTests: number, skippedTests: number } | null>(null)
let eventSource: EventSource | null = null

function connectToStream() {
  if (!import.meta.client) return
  if (eventSource) return
  if (!isLive.value) return

  eventSource = new EventSource(`/api/test-runs/${runId}/stream`)

  eventSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data)

      if (parsed.type === 'init') {
        liveProgress.value = {
          totalTests: parsed.data.totalTests,
          passedTests: parsed.data.passedTests,
          failedTests: parsed.data.failedTests,
          skippedTests: parsed.data.skippedTests
        }
      } else if (parsed.type === 'test-begin') {
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
          const idx = liveTestCases.value.findIndex(tc => `${tc.title}@@${tc.location}` === key)
          if (idx >= 0) {
            const tc = liveTestCases.value[idx]!
            tc.status = parsed.data.status
            tc.duration = parsed.data.duration
            tc.error = parsed.data.error
            tc.workerIndex = parsed.data.workerIndex ?? tc.workerIndex
          }
        } else {
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

watch(isLive, (live) => {
  if (live) {
    connectToStream()
  } else {
    disconnectStream()
  }
}, { immediate: true })

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

// Load network requests data lazily
const { data: networkEndpoints, pending: loadingEndpoints } = await useFetch<EndpointSummary[]>(
  `/api/test-runs/${runId}/network-requests`,
  { lazy: true, server: false }
)

const showCustomData = ref(false)

// Count visible metadata blocks to distribute grid space
const metadataBlockCount = computed(() => {
  let count = 0
  if (testRun.value?.metadata?.ci || testRun.value?.environment) count++
  if (testRun.value?.metadata?.scm) count++
  if (testRun.value?.metadata?.tags?.length || testRun.value?.metadata?.projectDescription || testRun.value?.metadata?.relatedIssue || testRun.value?.metadata?.customData) count++
  return count
})

const summaryColSpanClass = computed(() => {
  const n = metadataBlockCount.value
  if (n === 0) return 'lg:col-span-8'
  if (n === 3) return 'lg:col-span-5'
  if (n === 2) return 'lg:col-span-4'
  return 'lg:col-span-5'
})

const blockColSpanClass = computed(() => {
  const n = metadataBlockCount.value
  if (n === 3) return 'lg:col-span-1'
  if (n === 2) return 'lg:col-span-2'
  if (n === 1) return 'lg:col-span-3'
  return ''
})

// Merge reports from the new `reports` table with the legacy reportPath field
const allReports = computed<ReportInfo[]>(() => {
  if (!testRun.value) return []
  const list: ReportInfo[] = []

  if (testRun.value.reports && testRun.value.reports.length > 0) {
    list.push(...testRun.value.reports)
    return list
  }

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
  { label: 'Workers', icon: 'i-lucide-rows-3', value: 'workers' },
  { label: 'Compare', icon: 'i-lucide-git-compare-arrows', value: 'compare' },
  { label: 'Slow endpoints', icon: 'i-lucide-network', value: 'endpoints' }
]

// Ref for TestCasesList to call scrollToCase
const testCasesListRef: {
  value: { scrollToCase: (id: number) => void } | null
} = ref(null)

function handleSelectTestCase(id: number) {
  activeTab.value = 'test-cases'
  nextTick(() => {
    testCasesListRef.value?.scrollToCase(id)
  })
}

// ---- Run Comparison Feature ----
interface RunOption {
  label: string
  value: number
}

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
    // ignore
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

const currentRunRef = computed<TestRunDetails | null>(() => testRun.value ?? null)
const { comparisonData, comparisonSummary } = useRunComparison(baselineRun, currentRunRef)
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
      <!-- ===== TOP ROW: summary + metadata blocks ===== -->
      <div class="grid grid-cols-1 lg:grid-cols-8 gap-4">
        <div :class="summaryColSpanClass">
          <UCard class="shadow-xs h-full">
            <div class="space-y-3">
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
                    </div>
                    <p class="text-xs text-gray-500 mt-0.5">
                      {{ testRun?.project?.label ?? testRun?.project?.name }}
                      &middot; Started {{ testRun?.startTime ? new Date(testRun.startTime).toLocaleString() : 'N/A' }}
                    </p>
                  </div>
                </div>
                <div v-if="allReports.length > 0" class="shrink-0 hidden sm:flex items-start gap-2">
                  <RunReports :reports="allReports" />
                </div>
              </div>

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
                    <span class="inline-block size-1.5 rounded-full bg-green-500 mr-1 align-middle" /> Passed
                  </p>
                  <p class="text-xl font-bold mt-0.5 text-green-600 dark:text-green-400">
                    {{ displayProgress?.passedTests ?? testRun?.passedTests ?? 0 }}
                  </p>
                </div>
                <div class="rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
                  <p class="text-xs font-medium text-red-700 dark:text-red-400 uppercase tracking-wider">
                    <span class="inline-block size-1.5 rounded-full bg-red-500 mr-1 align-middle" /> Failed
                  </p>
                  <p class="text-xl font-bold mt-0.5 text-red-600 dark:text-red-400">
                    {{ displayProgress?.failedTests ?? testRun?.failedTests ?? 0 }}
                  </p>
                </div>
                <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
                  <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">
                    <span class="inline-block size-1.5 rounded-full bg-gray-400 mr-1 align-middle" /> Skipped
                  </p>
                  <p class="text-xl font-bold mt-0.5 text-gray-600 dark:text-gray-400">
                    {{ displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0 }}
                  </p>
                </div>
              </div>

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
              </div>

              <div v-if="allReports.length > 0" class="sm:hidden">
                <p class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
                  Reports
                </p>
                <RunReports :reports="allReports" />
              </div>
            </div>
          </UCard>
        </div>

        <!-- Block 1: CI + Environment -->
        <UCard v-if="testRun?.metadata?.ci || testRun?.environment" :class="blockColSpanClass">
          <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            <UIcon name="i-lucide-cloud" class="size-3.5 inline mr-1" /> CI / Env
          </h4>
          <div class="space-y-2 text-xs">
            <div v-if="testRun?.environment" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-server" class="size-3.5 text-gray-400 shrink-0" />
              <span class="font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300 px-1.5 py-0.5 rounded-full border border-blue-200 dark:border-blue-800">{{ testRun.environment }}</span>
            </div>
            <div v-if="testRun?.metadata?.ci?.provider" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-cloud" class="size-3.5 text-gray-400 shrink-0" />
              <span>{{ testRun.metadata.ci.provider }}</span>
            </div>
            <div v-if="testRun?.metadata?.ci?.buildNumber" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-hash" class="size-3.5 text-gray-400 shrink-0" />
              <span>Build #{{ testRun.metadata.ci.buildNumber }}</span>
            </div>
            <div v-if="testRun?.metadata?.ci?.jobName" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-notebook-pen" class="size-3.5 text-gray-400 shrink-0" />
              <span>{{ testRun.metadata.ci.jobName }}</span>
            </div>
            <div v-if="testRun?.metadata?.ci?.workflow" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-workflow" class="size-3.5 text-gray-400 shrink-0" />
              <span>{{ testRun.metadata.ci.workflow }}</span>
            </div>
            <a
              v-if="testRun?.metadata?.ci?.buildUrl"
              :href="testRun.metadata.ci.buildUrl"
              target="_blank"
              class="text-primary hover:underline inline-flex items-center gap-1 text-xs mt-1"
            >
              <UIcon name="i-lucide-external-link" class="size-3" /> View build
            </a>
          </div>
        </UCard>

        <!-- Block 2: Source control -->
        <UCard v-if="testRun?.metadata?.scm" :class="blockColSpanClass">
          <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            <UIcon name="i-lucide-git-branch" class="size-3.5 inline mr-1" /> Source
          </h4>
          <div class="space-y-2 text-xs">
            <div v-if="testRun.metadata.scm.branch" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-git-branch" class="size-3.5 text-gray-400 shrink-0" />
              <span class="font-medium">{{ testRun.metadata.scm.branch }}</span>
            </div>
            <div v-if="testRun.metadata.scm.commit" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-git-commit-horizontal" class="size-3.5 text-gray-400 shrink-0" />
              <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded font-mono">{{ testRun.metadata.scm.commit.length >= 8 ? testRun.metadata.scm.commit.substring(0, 8) : testRun.metadata.scm.commit }}</code>
            </div>
            <div v-if="testRun.metadata.scm.author" class="flex items-center gap-1.5">
              <UIcon name="i-lucide-user" class="size-3.5 text-gray-400 shrink-0" />
              <span>{{ testRun.metadata.scm.author }}</span>
            </div>
            <div v-if="testRun.metadata.scm.commitMessage">
              <p class="text-gray-400 mt-1 break-words">
                {{ testRun.metadata.scm.commitMessage }}
              </p>
            </div>
          </div>
        </UCard>

        <!-- Block 3: Tags / Details / Custom data -->
        <UCard v-if="testRun?.metadata?.tags?.length || testRun?.metadata?.projectDescription || testRun?.metadata?.relatedIssue || testRun?.metadata?.customData" :class="blockColSpanClass">
          <h4 class="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-3">
            <UIcon name="i-lucide-tags" class="size-3.5 inline mr-1" /> Other
          </h4>
          <div class="space-y-3 text-xs">
            <div v-if="testRun.metadata.tags && testRun.metadata.tags.length > 0">
              <div class="flex flex-wrap gap-1.5">
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
            </div>
            <p v-if="testRun.metadata.projectDescription" class="text-gray-700 dark:text-gray-300">
              {{ testRun.metadata.projectDescription }}
            </p>
            <p v-if="testRun.metadata.relatedIssue" class="flex items-center gap-1">
              <UIcon name="i-lucide-link" class="size-3.5 text-gray-400 shrink-0" />
              <span>{{ testRun.metadata.relatedIssue }}</span>
            </p>
            <UButton
              v-if="testRun.metadata.customData"
              size="xs"
              variant="ghost"
              color="neutral"
              :icon="showCustomData ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
              @click="showCustomData = !showCustomData"
            >
              Custom data
            </UButton>
            <div v-if="showCustomData && testRun.metadata.customData">
              <div class="bg-gray-50 dark:bg-gray-900 p-2.5 rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
                <pre class="m-0">{{ JSON.stringify(testRun.metadata.customData, null, 2) }}</pre>
              </div>
            </div>
          </div>
        </UCard>
      </div>

      <!-- ===== TABBED CONTENT PANEL ===== -->
      <UCard>
        <template #header>
          <UTabs v-model="activeTab" :items="tabItems" size="sm" />
        </template>

        <div class="overflow-y-auto" style="max-height: calc(100vh - 22rem)">
          <!-- Tab: Test cases -->
          <div v-if="activeTab === 'test-cases'">
            <TestCasesList
              ref="testCasesListRef"
              :test-cases="displayTestCases"
              :is-live="isLive"
            />
          </div>

          <!-- Tab: Workers -->
          <div v-if="activeTab === 'workers'">
            <WorkersTimeline
              v-if="displayTestCases.length > 0"
              :test-cases="displayTestCases"
              @select-test-case="handleSelectTestCase"
            />
            <div v-else class="text-center py-10 text-gray-500">
              <UIcon name="i-lucide-rows-3" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
              <p>No worker data available for this run.</p>
            </div>
          </div>

          <!-- Tab: Compare -->
          <div v-if="activeTab === 'compare'">
            <RunCompare
              :test-run="testRun!"
              :is-live="isLive"
              :project-run-options="projectRunOptions"
              :previous-run-id="previousRunId"
              :compare-run-a="compareRunA"
              :baseline-run="baselineRun"
              :loading-baseline="loadingBaseline"
              :comparison-data="comparisonData"
              :comparison-summary="comparisonSummary"
              @update:compare-run-a="compareRunA = $event"
              @compare-with-previous="compareWithPrevious"
            />
          </div>

          <!-- Tab: Slow endpoints -->
          <div v-if="activeTab === 'endpoints'">
            <SlowEndpoints
              :endpoints="networkEndpoints ?? null"
              :loading="loadingEndpoints"
            />
          </div>
        </div>
      </UCard>
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
