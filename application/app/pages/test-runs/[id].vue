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
      <RunSummary
        :test-run="testRun!"
        :display-progress="displayProgress"
        :all-reports="allReports"
        :show-custom-data="showCustomData"
        :summary-col-span-class="summaryColSpanClass"
        :block-col-span-class="blockColSpanClass"
        @update:show-custom-data="showCustomData = $event"
      />

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
            />
          </div>

          <!-- Tab: Slow endpoints -->
          <div v-if="activeTab === 'endpoints'">
            <SlowEndpoints />
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
