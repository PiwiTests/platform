<script setup lang="ts">
import { computed, nextTick, watch, onUnmounted } from 'vue';
import type { TestRunDetails, TestCaseResult, ReportInfo } from '~~/types/api';
import { subscribeDemoEvents } from '~/demo/run-events';

const route = useRoute();
const runId = route.params.id;
const isDemoMode = Boolean(useRuntimeConfig().public.demoMode);

const { data: testRun, refresh } = await useFetch<TestRunDetails>(`/api/test-runs/${runId}`);

useHead(
  computed(() => ({
    title: `Test run #${runId}${testRun.value?.project ? ` — ${testRun.value.project.name}` : ''} — Piwi Dashboard`,
  })),
);

const toast = useToast();
const isDeleteConfirmOpen = ref(false);
const deleting = ref(false);

// Live streaming state
const isLive = computed(() => testRun.value?.status === 'running' || testRun.value?.status === 'finalizing');
const isFinalizing = ref(false);
const liveTestCases = ref<TestCaseResult[]>([]);
const liveTestCaseKeys = new Map<string, true>();
const liveProgress = ref<{ totalTests: number; passedTests: number; failedTests: number; skippedTests: number } | null>(
  null,
);
let eventSource: EventSource | null = null;

// Combined test cases: from server data + live stream.
const displayTestCases = ref<TestCaseResult[]>([]);

watch(
  [isLive, testRun],
  () => {
    if (isLive.value && liveTestCases.value.length > 0) {
      displayTestCases.value = [...liveTestCases.value];
    } else if (testRun.value?.testCases) {
      displayTestCases.value = testRun.value.testCases;
    } else {
      displayTestCases.value = [];
    }
  },
  { immediate: true },
);

// Initialise liveTestCases from persisted data when SSE connects
function seedLiveFromPersisted(cases: TestCaseResult[]) {
  for (const tc of cases) {
    const key = `${tc.title}@@${tc.location}@@${JSON.stringify(tc.browser)}`;
    if (!liveTestCaseKeys.has(key)) {
      liveTestCaseKeys.set(key, true);
      liveTestCases.value = [...liveTestCases.value, tc];
    }
  }
  displayTestCases.value = [...liveTestCases.value];
}

// Debounced batch processing of SSE events to avoid cascading re-renders
let pendingEvents: Record<string, unknown>[] = [];
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

function flushPendingEvents() {
  if (pendingEvents.length === 0) return;
  const events = pendingEvents;
  pendingEvents = [];
  for (const parsed of events) {
    const data = parsed.data as Record<string, unknown>;
    if (parsed.type === 'init') {
      liveProgress.value = {
        totalTests: data.totalTests as number,
        passedTests: data.passedTests as number,
        failedTests: data.failedTests as number,
        skippedTests: data.skippedTests as number,
      };
    } else if (parsed.type === 'test-begin') {
      const d = data as {
        title: string;
        filePath?: string;
        suitePath?: string[] | null;
        location: string;
        workerIndex?: number;
        startedAt?: number;
        browser?: { projectName?: string } | null;
      };
      const key = `${d.title}@@${d.location}@@${JSON.stringify(d.browser)}`;
      if (!liveTestCaseKeys.has(key)) {
        liveTestCaseKeys.set(key, true);
        liveTestCases.value = [
          ...liveTestCases.value,
          {
            id: liveTestCases.value.length + 1,
            title: d.title,
            filePath: d.filePath,
            suitePath: d.suitePath ?? undefined,
            status: 'running',
            location: d.location,
            workerIndex: d.workerIndex ?? null,
            startedAt: d.startedAt ?? Date.now(),
            browser: d.browser ?? null,
          },
        ];
        displayTestCases.value = [...liveTestCases.value];
      }
    } else if (parsed.type === 'test-completed') {
      const d = data as {
        title: string;
        filePath?: string;
        suitePath?: string[] | null;
        location: string;
        status: string;
        duration?: number;
        error?: string | null;
        workerIndex?: number;
        startedAt?: number;
        browser?: { projectName?: string } | null;
      };
      const key = `${d.title}@@${d.location}@@${JSON.stringify(d.browser)}`;
      if (liveTestCaseKeys.has(key)) {
        const idx = liveTestCases.value.findIndex(
          (tc) => `${tc.title}@@${tc.location}@@${JSON.stringify(tc.browser)}` === key,
        );
        if (idx >= 0) {
          const existing = liveTestCases.value[idx]!;
          const copy = [...liveTestCases.value];
          copy[idx] = {
            ...existing,
            filePath: d.filePath ?? existing.filePath,
            suitePath: d.suitePath ?? existing.suitePath,
            status: d.status,
            duration: d.duration,
            error: d.error,
            workerIndex: d.workerIndex ?? existing.workerIndex,
            startedAt: d.startedAt ? d.startedAt : existing.startedAt,
            browser: d.browser ?? existing.browser,
          };
          liveTestCases.value = copy;
          displayTestCases.value = [...copy];
        }
      } else {
        liveTestCaseKeys.set(key, true);
        liveTestCases.value = [
          ...liveTestCases.value,
          {
            id: liveTestCases.value.length + 1,
            title: d.title,
            filePath: d.filePath,
            suitePath: d.suitePath ?? undefined,
            status: d.status,
            duration: d.duration,
            location: d.location,
            error: d.error,
            workerIndex: d.workerIndex ?? null,
            startedAt: d.startedAt ?? undefined,
            browser: d.browser ?? null,
          },
        ];
        displayTestCases.value = [...liveTestCases.value];
      }
    } else if (parsed.type === 'run-progress') {
      liveProgress.value = data as {
        totalTests: number;
        passedTests: number;
        failedTests: number;
        skippedTests: number;
      };
    } else if (parsed.type === 'run-finalizing') {
      // Tests are done, reports/traces are uploading — show progress bar
      isFinalizing.value = true;
      liveProgress.value = data as {
        totalTests: number;
        passedTests: number;
        failedTests: number;
        skippedTests: number;
      };
    } else if (parsed.type === 'run-finished') {
      isFinalizing.value = false;
      disconnectStream();
      refresh();
      pollForReports();
    }
  }
}

function pollForReports(attempts = 0): void {
  // The reporter may upload HTML/Monocart reports AFTER the run finishes.
  // Poll briefly so they appear without requiring a manual refresh.
  if (isDemoMode) return; // demo mode has no file uploads
  if (attempts >= 10) return;
  setTimeout(
    async () => {
      await refresh();
      if (allReports.value.length === 0) {
        pollForReports(attempts + 1);
      }
    },
    1500 * (attempts + 1),
  );
}

function enqueueEvent(event: Record<string, unknown>) {
  pendingEvents.push(event);
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(flushPendingEvents, 200);
}

// Demo mode: live events arrive over a BroadcastChannel from the service
// worker instead of an SSE stream (see app/demo/run-events.ts).
let demoUnsubscribe: (() => void) | null = null;

function connectToDemoStream() {
  if (demoUnsubscribe) return;

  // Seed liveTestCases from persisted data so existing cases are visible
  // immediately with correct ids, browser, startedAt, etc.
  if (testRun.value?.testCases?.length) {
    seedLiveFromPersisted(testRun.value.testCases);
  }

  demoUnsubscribe = subscribeDemoEvents((message) => {
    if (message.scope === 'run' && message.runId === Number(runId)) {
      enqueueEvent(message.event as unknown as Record<string, unknown>);
    } else if (
      message.scope === 'global' &&
      message.event.runId === Number(runId) &&
      message.event.type === 'run-started'
    ) {
      // Run transitioned from 'initialising' to 'running' — refetch so
      // isLive flips and progress counters appear.
      refresh();
    }
  });
}

function connectToStream() {
  if (!import.meta.client) return;

  if (isDemoMode) {
    connectToDemoStream();
    return;
  }

  if (eventSource) return;
  if (!isLive.value) return;

  // Seed liveTestCases from persisted data so existing cases are visible
  // immediately with correct ids, browser, startedAt, etc.
  if (testRun.value?.testCases?.length) {
    seedLiveFromPersisted(testRun.value.testCases);
  }

  eventSource = new EventSource(`/api/test-runs/${runId}/stream`);

  eventSource.onmessage = (event) => {
    try {
      enqueueEvent(JSON.parse(event.data) as Record<string, unknown>);
    } catch {
      // Ignore parse errors
    }
  };

  eventSource.onerror = () => {
    // EventSource will auto-reconnect
  };
}

function disconnectStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  if (demoUnsubscribe) {
    demoUnsubscribe();
    demoUnsubscribe = null;
  }
}

// In demo mode also stream while 'initialising' so the page picks up the
// transition to 'running' pushed by the simulator.
const shouldStream = computed(() => isLive.value || (isDemoMode && testRun.value?.status === 'initialising'));

watch(
  shouldStream,
  (live) => {
    if (live) {
      connectToStream();
    } else {
      disconnectStream();
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  disconnectStream();
});

// Throttled version for child components that don't need frame-perfect reactivity
let rafId: number | null = null;
const throttledTestCases = ref<TestCaseResult[]>([]);

watch(
  displayTestCases,
  (val) => {
    if (!import.meta.client) {
      throttledTestCases.value = val;
      return;
    }
    if (rafId !== null) return;
    rafId = requestAnimationFrame(() => {
      throttledTestCases.value = val;
      rafId = null;
    });
  },
  { immediate: true },
);

// Display progress: live or from loaded data
const displayProgress = computed(() => {
  if (isLive.value && liveProgress.value) {
    return liveProgress.value;
  }
  if (!testRun.value) return null;
  return {
    totalTests: testRun.value.totalTests,
    passedTests: testRun.value.passedTests,
    failedTests: testRun.value.failedTests,
    skippedTests: testRun.value.skippedTests,
  };
});

async function handleDeleteRun() {
  isDeleteConfirmOpen.value = false;
  deleting.value = true;
  try {
    await $fetch(`/api/test-runs/${runId}`, { method: 'DELETE' });
    toast.add({ title: 'Test run deleted', color: 'success' });
    await navigateTo(`/projects/${testRun.value?.project?.id}`);
  } catch (error: unknown) {
    const errorMessage =
      error && typeof error === 'object' && 'data' in error ? (error.data as { message?: string })?.message : undefined;
    toast.add({ title: 'Delete failed', description: errorMessage || 'An error occurred', color: 'error' });
  } finally {
    deleting.value = false;
  }
}

const showCustomData = ref(false);

const { summaryColSpanClass, blockColSpanClass } = useDetailGrid(() => {
  let count = 0;
  if (testRun.value?.metadata?.ci || testRun.value?.environment) count++;
  if (testRun.value?.metadata?.scm) count++;
  if ((testRun.value?.storageStats && testRun.value.storageStats.totalFiles > 0) || isFinalizing.value) count++;
  if (
    testRun.value?.metadata?.tags?.length ||
    testRun.value?.metadata?.projectDescription ||
    testRun.value?.metadata?.relatedIssue ||
    testRun.value?.metadata?.customData
  )
    count++;
  return count;
});

// Test-cases filter state — lifted here so it survives tab switches
const testCaseSearch = ref('');
const testCaseActiveStatuses = ref<string[]>([]);
const testCaseBrowserFilter = ref('all');

// Derive a single string for RunSummary's activeFilter highlight
const statusFilterForSummary = computed(() =>
  testCaseActiveStatuses.value.length === 1 ? testCaseActiveStatuses.value[0]! : 'all',
);

function handleFilterStatus(status: string) {
  testCaseActiveStatuses.value = !status || status === 'all' ? [] : [status];
}

// Reports from the files table
const allReports = computed<ReportInfo[]>(() => testRun.value?.reports || []);

// Right panel tabs
const activeTab = ref('test-cases');

// Cluster filter state — set by FailureGroups, consumed by TestCasesList
const selectedClusterFilter = ref<number | null>(null);

// Endpoints count from SlowEndpoints
const endpointsCount = ref(0);

function clearClusterFilter() {
  selectedClusterFilter.value = null;
}

const hasFailures = computed(() => testRun.value && testRun.value.failedTests > 0);

const failureGroupCount = computed(() => {
  if (!testRun.value?.testCases) return 0;
  const clusterIds = new Set<number>();
  for (const tc of testRun.value.testCases) {
    if (tc.failureClusterId != null) clusterIds.add(tc.failureClusterId);
  }
  return clusterIds.size;
});

const uniqueWorkerCount = computed(() => {
  const cases = isLive.value ? displayTestCases.value : testRun.value?.testCases;
  if (!cases || cases.length === 0) return 0;
  const workers = new Set<number>();
  for (const tc of cases) {
    if (tc.workerIndex != null && tc.workerIndex >= 0) workers.add(tc.workerIndex);
  }
  return workers.size;
});

const tabItems = computed(() => [
  {
    label: `Test cases (${displayTestCases.value.length})`,
    icon: 'i-lucide-beaker',
    value: 'test-cases',
    slot: 'test-cases',
  },
  ...(hasFailures.value
    ? [
        {
          label: `Failure groups (${failureGroupCount.value})`,
          icon: 'i-lucide-layers',
          value: 'failure-groups',
          slot: 'failure-groups',
        },
      ]
    : []),
  ...(hasFailures.value
    ? [{ label: 'Regression', icon: 'i-lucide-git-pull-request-arrow', value: 'regression', slot: 'regression' }]
    : []),
  {
    label: `Timeline${uniqueWorkerCount.value > 0 ? ` (${uniqueWorkerCount.value})` : ''}`,
    icon: 'i-lucide-timeline',
    value: 'workers',
    slot: 'workers',
  },
  { label: 'Compare', icon: 'i-lucide-git-compare-arrows', value: 'compare', slot: 'compare' },
  {
    label: `Slow endpoints${endpointsCount.value > 0 ? ` (${endpointsCount.value})` : ''}`,
    icon: 'i-lucide-network',
    value: 'endpoints',
    slot: 'endpoints',
  },
]);

const tabPanelClass: Record<string, string> = {
  'test-cases': 'overflow-hidden flex flex-col',
  endpoints: 'overflow-hidden flex flex-col',
};

// Ref for TestCasesList to call scrollToCase
const testCasesListRef: {
  value: { scrollToCase: (id: number) => void } | null;
} = ref(null);

function handleSelectTestCase(id: number) {
  activeTab.value = 'test-cases';
  nextTick(() => {
    testCasesListRef.value?.scrollToCase(id);
  });
}

function handleSelectCluster(clusterId: number) {
  selectedClusterFilter.value = clusterId;
  activeTab.value = 'test-cases';
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
              ...(testRun?.project?.id
                ? [
                    {
                      label: testRun.project.label || testRun.project.name || 'Project',
                      to: `/projects/${testRun.project.id}`,
                    },
                  ]
                : [{ label: 'Project' }]),
              { label: `Run #${runId}` + (testRun?.label ? ` — ${testRun.label}` : '') },
            ]"
          />
        </template>
        <template #right>
          <UButton icon="i-lucide-refresh-cw" size="md" label="Refresh" @click="() => refresh()" />
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
      <DetailPageLayout v-model="activeTab" :tab-items="tabItems" :tab-panel-class="tabPanelClass">
        <template #summary>
          <RunSummary
            v-if="testRun"
            :test-run="testRun"
            :display-progress="displayProgress"
            :all-reports="allReports"
            :show-custom-data="showCustomData"
            :summary-col-span-class="summaryColSpanClass"
            :block-col-span-class="blockColSpanClass"
            :finalizing="isFinalizing"
            :active-filter="statusFilterForSummary"
            @update:show-custom-data="showCustomData = $event"
            @filter-status="handleFilterStatus"
            @label-updated="refresh"
          />
        </template>

        <template #tab-test-cases>
          <div v-if="selectedClusterFilter != null" class="flex items-center gap-2 mb-3 shrink-0">
            <UBadge color="info" variant="subtle" size="sm"> Filtered by failure group </UBadge>
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
            v-model:search="testCaseSearch"
            v-model:active-statuses="testCaseActiveStatuses"
            v-model:browser-filter="testCaseBrowserFilter"
            :test-cases="displayTestCases"
            :suites="testRun?.suites ?? []"
            :is-live="isLive"
            :failure-cluster-filter="selectedClusterFilter"
            class="flex-1 min-h-0"
          />
        </template>

        <template #tab-failure-groups>
          <FailureGroups @select-cluster="handleSelectCluster" />
        </template>

        <template #tab-regression>
          <RegressionContext />
        </template>

        <template #tab-workers>
          <WorkersTimeline
            :test-cases="throttledTestCases"
            :setup-steps="testRun?.setupSteps ?? null"
            :shard-total="testRun?.shardTotal ?? null"
            :live="isLive"
            @select-test-case="handleSelectTestCase"
          />
        </template>

        <template #tab-compare>
          <RunCompare />
        </template>

        <template #tab-endpoints>
          <SlowEndpoints class="flex-1 min-h-0" @endpoints-count="endpointsCount = $event" />
        </template>
      </DetailPageLayout>
    </template>
  </UDashboardPanel>

  <!-- Delete Confirm Dialog -->
  <ClientOnly>
    <UModal :open="isDeleteConfirmOpen" title="Delete test run" @update:open="isDeleteConfirmOpen = $event">
      <template #body>
        <p>
          Are you sure you want to delete <strong>Test Run #{{ testRun?.id }}</strong
          >? This will also remove all associated test results, reports, and traces. This action cannot be undone.
        </p>
      </template>
      <template #footer>
        <UButton color="neutral" variant="ghost" label="Cancel" @click="isDeleteConfirmOpen = false" />
        <UButton color="error" label="Delete" icon="i-lucide-trash-2" :loading="deleting" @click="handleDeleteRun" />
      </template>
    </UModal>
  </ClientOnly>
</template>
