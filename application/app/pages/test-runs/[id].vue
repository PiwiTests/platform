<script setup lang="ts">
import { computed, nextTick, watch, onUnmounted } from 'vue'
import type { TestRunDetails, TestCaseResult, ReportInfo } from '~~/types/api'

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

// Debounced batch processing of SSE events to avoid cascading re-renders
let pendingEvents: Record<string, unknown>[] = []
let debounceTimer: ReturnType<typeof setTimeout> | null = null

function flushPendingEvents() {
  if (pendingEvents.length === 0) return
  const events = pendingEvents
  pendingEvents = []
  for (const parsed of events) {
    const data = parsed.data as Record<string, unknown>
    if (parsed.type === 'init') {
      liveProgress.value = {
        totalTests: data.totalTests as number,
        passedTests: data.passedTests as number,
        failedTests: data.failedTests as number,
        skippedTests: data.skippedTests as number
      }
    } else if (parsed.type === 'test-begin') {
      const d = data as { title: string, location: string, workerIndex?: number, startedAt?: number }
      const key = `${d.title}@@${d.location}`
      if (!liveTestCaseKeys.has(key)) {
        liveTestCaseKeys.set(key, true)
        liveTestCases.value = [...liveTestCases.value, {
          id: liveTestCases.value.length + 1,
          title: d.title,
          status: 'running',
          location: d.location,
          workerIndex: d.workerIndex ?? null,
          startedAt: d.startedAt ?? Date.now()
        }]
        displayTestCases.value = [...liveTestCases.value]
      }
    } else if (parsed.type === 'test-completed') {
      const d = data as { title: string, location: string, status: string, duration?: number, error?: string | null, workerIndex?: number, startedAt?: number }
      const key = `${d.title}@@${d.location}`
      if (liveTestCaseKeys.has(key)) {
        const idx = liveTestCases.value.findIndex(tc => `${tc.title}@@${tc.location}` === key)
        if (idx >= 0) {
          const copy = [...liveTestCases.value]
          copy[idx] = {
            ...copy[idx]!,
            status: d.status,
            duration: d.duration,
            error: d.error,
            workerIndex: d.workerIndex ?? copy[idx]!.workerIndex,
            startedAt: d.startedAt ? d.startedAt : copy[idx]!.startedAt
          }
          liveTestCases.value = copy
          displayTestCases.value = [...copy]
        }
      } else {
        liveTestCaseKeys.set(key, true)
        liveTestCases.value = [...liveTestCases.value, {
          id: liveTestCases.value.length + 1,
          title: d.title,
          status: d.status,
          duration: d.duration,
          location: d.location,
          error: d.error,
          workerIndex: d.workerIndex ?? null,
          startedAt: d.startedAt ?? undefined
        }]
        displayTestCases.value = [...liveTestCases.value]
      }
    } else if (parsed.type === 'run-progress') {
      liveProgress.value = data as { totalTests: number, passedTests: number, failedTests: number, skippedTests: number }
    } else if (parsed.type === 'run-finished') {
      disconnectStream()
      refresh()
    }
  }
}

function connectToStream() {
  if (!import.meta.client) return
  if (eventSource) return
  if (!isLive.value) return

  eventSource = new EventSource(`/api/test-runs/${runId}/stream`)

  eventSource.onmessage = (event) => {
    try {
      pendingEvents.push(JSON.parse(event.data) as Record<string, unknown>)
      if (debounceTimer) clearTimeout(debounceTimer)
      debounceTimer = setTimeout(flushPendingEvents, 200)
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

// Combined test cases: from server data + live stream.
const displayTestCases = ref<TestCaseResult[]>([])

watch([isLive, testRun], () => {
  if (isLive.value && liveTestCases.value.length > 0) {
    displayTestCases.value = [...liveTestCases.value]
  } else if (testRun.value?.testCases) {
    displayTestCases.value = testRun.value.testCases
  } else {
    displayTestCases.value = []
  }
}, { immediate: true })

// Throttled version for child components that don't need frame-perfect reactivity
let rafId: number | null = null
const throttledTestCases = ref<TestCaseResult[]>([])

watch(displayTestCases, (val) => {
  if (!import.meta.client) {
    throttledTestCases.value = val
    return
  }
  if (rafId !== null) return
  rafId = requestAnimationFrame(() => {
    throttledTestCases.value = val
    rafId = null
  })
}, { immediate: true })

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

const showCustomData = ref(false)

const { summaryColSpanClass, blockColSpanClass } = useDetailGrid(() => {
  let count = 0
  if (testRun.value?.metadata?.ci || testRun.value?.environment) count++
  if (testRun.value?.metadata?.scm) count++
  if (testRun.value?.storageStats && testRun.value.storageStats.totalFiles > 0) count++
  if (testRun.value?.metadata?.tags?.length || testRun.value?.metadata?.projectDescription || testRun.value?.metadata?.relatedIssue || testRun.value?.metadata?.customData) count++
  return count
})

// Reports from the files table
const allReports = computed<ReportInfo[]>(() => testRun.value?.reports || [])

// Right panel tabs
const activeTab = ref('test-cases')

// Cluster filter state — set by FailureGroups, consumed by TestCasesList
const selectedClusterFilter = ref<number | null>(null)

// Endpoints count from SlowEndpoints
const endpointsCount = ref(0)

function clearClusterFilter() {
  selectedClusterFilter.value = null
}

const hasFailures = computed(() =>
  testRun.value && testRun.value.failedTests > 0
)

const failureGroupCount = computed(() => {
  if (!testRun.value?.testCases) return 0
  const clusterIds = new Set<number>()
  for (const tc of testRun.value.testCases) {
    if (tc.failureClusterId != null) clusterIds.add(tc.failureClusterId)
  }
  return clusterIds.size
})

const uniqueWorkerCount = computed(() => {
  if (!testRun.value?.testCases) return 0
  const workers = new Set<number>()
  for (const tc of testRun.value.testCases) {
    if (tc.workerIndex != null) workers.add(tc.workerIndex)
  }
  return workers.size
})

const tabItems = computed(() => [
  { label: `Test cases (${displayTestCases.value.length})`, icon: 'i-lucide-beaker', value: 'test-cases', slot: 'test-cases' },
  ...(hasFailures.value ? [{ label: `Failure groups (${failureGroupCount.value})`, icon: 'i-lucide-layers', value: 'failure-groups', slot: 'failure-groups' }] : []),
  ...(hasFailures.value ? [{ label: 'Regression', icon: 'i-lucide-git-pull-request-arrow', value: 'regression', slot: 'regression' }] : []),
  { label: `Workers${uniqueWorkerCount.value > 0 ? ` (${uniqueWorkerCount.value})` : ''}`, icon: 'i-lucide-rows-3', value: 'workers', slot: 'workers' },
  { label: 'Compare', icon: 'i-lucide-git-compare-arrows', value: 'compare', slot: 'compare' },
  { label: `Slow endpoints${endpointsCount.value > 0 ? ` (${endpointsCount.value})` : ''}`, icon: 'i-lucide-network', value: 'endpoints', slot: 'endpoints' }
])

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

function handleSelectCluster(clusterId: number) {
  selectedClusterFilter.value = clusterId
  activeTab.value = 'test-cases'
}
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
      <div class="flex flex-col h-full overflow-y-auto gap-4 p-1">
        <RunSummary
          v-if="testRun"
          :test-run="testRun"
          :display-progress="displayProgress"
          :all-reports="allReports"
          :show-custom-data="showCustomData"
          :summary-col-span-class="summaryColSpanClass"
          :block-col-span-class="blockColSpanClass"
          @update:show-custom-data="showCustomData = $event"
        />

        <!-- ===== TABBED CONTENT PANEL ===== -->
        <UTabs
          v-model="activeTab"
          :items="tabItems"
          size="sm"
          class="shrink-0"
        >
          <template #test-cases>
            <div v-if="selectedClusterFilter != null" class="flex items-center gap-2 mb-3 pt-4">
              <UBadge color="info" variant="subtle" size="sm">
                Filtered by failure group
              </UBadge>
              <UButton
                size="xs"
                color="neutral"
                variant="ghost"
                icon="i-lucide-x"
                label="Clear filter"
                @click="clearClusterFilter"
              />
            </div>
            <TestCasesList
              ref="testCasesListRef"
              :test-cases="displayTestCases"
              :is-live="isLive"
              :failure-cluster-filter="selectedClusterFilter"
            />
          </template>

          <template #failure-groups>
            <FailureGroups
              @select-test-case="handleSelectTestCase"
              @select-cluster="handleSelectCluster"
            />
          </template>

          <template #regression>
            <RegressionContext />
          </template>

          <template #workers>
            <WorkersTimeline
              :test-cases="throttledTestCases"
              :live="isLive"
              @select-test-case="handleSelectTestCase"
            />
          </template>

          <template #compare>
            <RunCompare />
          </template>

          <template #endpoints>
            <SlowEndpoints @endpoints-count="endpointsCount = $event" />
          </template>
        </UTabs>
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
