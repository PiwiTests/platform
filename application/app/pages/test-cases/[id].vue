<script setup lang="ts">
import type { PerformanceStep, WebVitals, NetworkRequest, TestCaseHistoryPoint, TraceInfo } from '~~/types/api';
import type { TableColumn } from '@nuxt/ui';
import { h, resolveComponent } from 'vue';
import { getPerformanceHints } from '~/utils/performance-hints';

const route = useRoute();
const testCaseId = route.params.id;

const { data: testCase, refresh } = await useFetch(`/api/test-cases/${testCaseId}`);
const { data: historyData } = await useFetch<TestCaseHistoryPoint[]>(`/api/test-cases/${testCaseId}/history`);
const { data: traceData, refresh: refreshTraces } = await useFetch<TraceInfo[]>(`/api/test-cases/${testCaseId}/traces`);

useHead(
  computed(() => ({
    title: `${testCase.value?.title || `Test case #${testCaseId}`} — Piwi Dashboard`,
  })),
);

const performanceHints = computed(() => {
  if (!testCase.value) return [];
  return getPerformanceHints(testCase.value);
});

const steps = computed(() => {
  if (!testCase.value?.steps) return [];
  return testCase.value.steps as PerformanceStep[];
});

const webVitals = computed<WebVitals | null>(() => {
  return (testCase.value?.webVitals as unknown as WebVitals | null) ?? null;
});

const networkRequests = computed<NetworkRequest[]>(() => {
  return (testCase.value?.networkRequests as unknown as NetworkRequest[] | null) ?? [];
});

interface GroupedRequest {
  key: string;
  method: string;
  route: string;
  count: number;
  avgDuration: number;
  maxDuration: number;
}

const allServerLogs = computed(() => {
  const logs: import('~~/types/api').ServerLogEntry[] = [];
  for (const req of networkRequests.value) {
    if (Array.isArray(req.serverLogs)) {
      for (const entry of req.serverLogs) logs.push(entry);
    }
  }
  return logs.sort((a, b) => a.timestamp - b.timestamp);
});

const groupedNetworkRequests = computed<GroupedRequest[]>(() => {
  const map = new Map<string, { method: string; route: string; durations: number[] }>();
  for (const req of networkRequests.value) {
    if (req.resourceType && !['fetch', 'xhr', 'document', 'other'].includes(req.resourceType)) continue;
    const route = normalizeRoute(req.url);
    const key = `${req.method}|${route}`;
    if (!map.has(key)) map.set(key, { method: req.method, route, durations: [] });
    map.get(key)!.durations.push(req.duration);
  }
  return Array.from(map.entries())
    .map(([key, g]) => ({
      key,
      method: g.method,
      route: g.route,
      count: g.durations.length,
      avgDuration: Math.round(g.durations.reduce((a, b) => a + b, 0) / g.durations.length),
      maxDuration: Math.max(...g.durations),
    }))
    .sort((a, b) => b.avgDuration - a.avgDuration);
});

const historicalTiming = computed(() => {
  if (!historyData.value || historyData.value.length < 2 || !testCase.value?.duration) return null;
  const previous = historyData.value.filter((h) => h.duration !== null && h.id !== testCase.value?.id);
  if (previous.length === 0) return null;
  const avg = previous.reduce((sum, h) => sum + (h.duration || 0), 0) / previous.length;
  const current = testCase.value.duration;
  const diff = current - avg;
  const pct = avg > 0 ? Math.round((diff / avg) * 100) : 0;
  return { avg: Math.round(avg), current, diff: Math.round(diff), pct };
});

const metadata = computed(() => {
  return testCase.value?.testRun?.metadata as Record<string, unknown> | null | undefined;
});

const scmInfo = computed(() => {
  const m = metadata.value;
  if (!m?.scm) return null;
  return m.scm as { commit?: string; branch?: string; author?: string; commitMessage?: string };
});

const ciInfo = computed(() => {
  const m = metadata.value;
  if (!m?.ci) return null;
  return m.ci as { provider?: string; buildNumber?: string; buildUrl?: string; workflow?: string };
});

const failureCluster = computed(() => {
  return (testCase.value?.failureCluster ?? null) as {
    id: number;
    sameRunCaseCount: number;
    isNew: boolean;
    firstSeenRunId: number;
    firstSeenAt: string | null;
  } | null;
});

const UBadge = resolveComponent('UBadge');

const activeTab = ref('steps');

const { summaryColSpanClass, blockColSpanClass } = useDetailGrid(() => {
  let count = 0;
  if (scmInfo.value) count++;
  if (ciInfo.value || testCase.value?.testRun?.environment) count++;
  if (testCase.value?.browser) count++;
  if (
    (traceData.value?.length ?? 0) > 0 ||
    ((testCase.value as { attachments?: { length: number } } | null)?.attachments?.length ?? 0) > 0
  )
    count++;
  return count;
});

const tabItems = computed(() => [
  { label: `Steps (${steps.value.length})`, icon: 'i-lucide-list-checks', value: 'steps', slot: 'steps' },
  { label: 'Traces & Console', icon: 'i-lucide-terminal', value: 'traces', slot: 'traces' },
  { label: 'Diagnosis', icon: 'i-lucide-bug', value: 'error', slot: 'error', disabled: !testCase.value?.error },
  {
    label: `Performance (${performanceHints.value.length})`,
    icon: 'i-lucide-gauge',
    value: 'performance',
    slot: 'performance',
    disabled: performanceHints.value.length === 0,
  },
  {
    label: `History (${historyData.value?.length ?? 0})`,
    icon: 'i-lucide-trending-up',
    value: 'history',
    slot: 'history',
    disabled: !historyData.value?.length,
  },
]);

const historyColumns: TableColumn<TestCaseHistoryPoint>[] = [
  {
    accessorKey: 'startTime',
    header: () => h('span', 'Date'),
    cell: ({ row }) => {
      const ts = row.getValue('startTime') as string | Date;
      const d = new Date(ts);
      return h('span', { class: 'text-xs whitespace-nowrap' }, [
        h('span', { class: 'text-gray-500' }, d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
        h(
          'span',
          { class: 'text-gray-400 ml-1' },
          d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }),
        ),
      ]);
    },
  },
  {
    accessorKey: 'status',
    header: () => h('span', 'Status'),
    cell: ({ row }) => {
      const status = row.getValue('status') as string;
      const color = getStatusColor(status);
      return h(UBadge, { color, class: 'capitalize' }, () => status);
    },
  },
  {
    accessorKey: 'duration',
    header: () => h('span', 'Duration'),
    cell: ({ row }) => {
      const val = row.getValue('duration') as number | null;
      return val !== null ? formatDuration(val) : h('span', { class: 'text-gray-400' }, '—');
    },
  },
  {
    accessorKey: 'retries',
    header: () => h('span', 'Retries'),
    cell: ({ row }) => {
      const retries = row.getValue('retries') as number | null;
      return retries && retries > 0 ? retries.toString() : '';
    },
  },
  {
    accessorKey: 'runId',
    header: () => h('span', 'Run'),
    cell: ({ row }) => {
      const runId = row.getValue('runId') as number;
      return h(
        'a',
        {
          href: `/test-runs/${runId}`,
          class: 'text-primary hover:underline',
          onClick: (e: MouseEvent) => {
            e.preventDefault();
            navigateTo(`/test-runs/${runId}`);
          },
        },
        `#${runId}`,
      );
    },
  },
  {
    accessorKey: 'error',
    header: () => h('span', 'Error'),
    cell: ({ row }) => {
      const err = row.getValue('error') as string | null;
      if (!err) return '';
      const truncated = err.length > 80 ? `${err.substring(0, 80)}…` : err;
      return h('span', { class: 'text-red-600 text-xs truncate max-w-xs block', title: err }, truncated);
    },
  },
];

const stepCategoryColor: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  navigation: 'info',
  assertion: 'success',
  action: 'warning',
};

const stepColumns: TableColumn<PerformanceStep>[] = [
  {
    accessorKey: 'category',
    header: () => h('span', 'Category'),
    cell: ({ row }) => {
      const cat = row.getValue('category') as string;
      const color = stepCategoryColor[cat] || 'neutral';
      return h(UBadge, { color, variant: 'soft', size: 'xs' }, () => cat);
    },
  },
  {
    accessorKey: 'title',
    header: () => h('span', 'Step'),
    cell: ({ row }) => {
      const title = row.getValue('title') as string;
      return h('span', { class: 'truncate block text-sm' }, title);
    },
  },
  {
    accessorKey: 'duration',
    header: () => h('span', 'Duration'),
    cell: ({ row }) => {
      const dur = row.getValue('duration') as number;
      const color = dur > 2000 ? 'text-red-600 font-medium' : dur > 500 ? 'text-orange-500' : 'text-gray-500';
      return h('span', { class: `${color} text-sm tabular-nums` }, formatDuration(dur));
    },
  },
];

// Calculated metadata for template
const environment = computed(() => testCase.value?.testRun?.environment);

// Live updates: while the parent run is still active, the reporter uploads
// traces/attachments as each test finishes ('case-files' SSE events) —
// refresh so they appear without a manual reload.
const isDemoMode = Boolean(useRuntimeConfig().public.demoMode);
let eventSource: EventSource | null = null;

const runIsActive = computed(() => {
  const status = testCase.value?.testRun?.status;
  return status === 'running' || status === 'finalizing';
});

function connectToRunStream() {
  if (!import.meta.client || isDemoMode || eventSource) return;
  const runId = testCase.value?.testRun?.id;
  if (!runId) return;

  eventSource = new EventSource(`/api/test-runs/${runId}/stream`);
  eventSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'case-files' && parsed.data?.testRunsCaseId === Number(testCaseId)) {
        refresh();
        refreshTraces();
      } else if (parsed.type === 'run-finished') {
        refresh();
        refreshTraces();
        disconnectRunStream();
      }
    } catch {
      // Ignore non-JSON messages (e.g. heartbeat comments)
    }
  };
  eventSource.onerror = () => {
    // EventSource will auto-reconnect
  };
}

function disconnectRunStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

watch(
  runIsActive,
  (active) => {
    if (active) connectToRunStream();
    else disconnectRunStream();
  },
  { immediate: true },
);

onUnmounted(disconnectRunStream);
</script>

<template>
  <UDashboardPanel id="test-case-detail">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              ...(testCase?.testRun?.project?.id
                ? [
                    {
                      label: testCase.testRun.project.name || 'Project',
                      to: `/projects/${testCase.testRun.project.id}`,
                    },
                  ]
                : [{ label: 'Project' }]),
              ...(testCase?.testRun?.id
                ? [{ label: `Test run #${testCase.testRun.id}`, to: `/test-runs/${testCase.testRun.id}` }]
                : [{ label: 'Test run' }]),
              { label: testCase?.title || `Test case #${testCaseId}` },
            ]"
          />
        </template>
        <template #right>
          <UButton icon="i-lucide-refresh-cw" size="md" label="Refresh" @click="() => refresh()" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <DetailPageLayout v-model="activeTab" :tab-items="tabItems">
        <template #summary>
          <TestCaseSummary
            :test-case="(testCase ?? null) as any"
            :scm-info="scmInfo"
            :ci-info="ciInfo"
            :browser="testCase?.browser ?? null"
            :environment="environment"
            :steps-count="steps.length"
            :historical-timing="historicalTiming"
            :summary-col-span-class="summaryColSpanClass"
            :block-col-span-class="blockColSpanClass"
            :traces="traceData ?? []"
            :attachments="(testCase as any)?.attachments ?? []"
            @refresh="refresh()"
          />
        </template>

        <template #tab-error>
            <div class="space-y-4 pt-4">
              <TestCaseErrorCard v-if="testCase?.error" :cluster="failureCluster" />

              <SectionCard v-if="testCase?.error" icon="i-lucide-bug" icon-class="text-red-500" title="Error">
                <pre
                  class="text-xs font-mono whitespace-pre-wrap break-words text-red-600 dark:text-red-400 max-h-96 overflow-y-auto"
                  >{{ testCase.error }}</pre
                >
              </SectionCard>

              <SectionCard v-if="testCase?.ariaSnapshot" icon="i-lucide-scan-text" title="ARIA snapshot">
                <pre class="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto">{{
                  testCase.ariaSnapshot
                }}</pre>
              </SectionCard>

              <p v-else-if="testCase?.error" class="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
                <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
                ARIA snapshot not captured — make sure your test imports
                <code class="rounded bg-gray-100 px-1 dark:bg-gray-800">test</code>
                from the piwi-dashboard fixtures.
              </p>
            </div>
          </template>

          <template #tab-steps>
            <div class="space-y-4 pt-4">
              <div v-if="steps.length > 0">
                <UTable
                  :data="steps"
                  :columns="stepColumns"
                  :ui="{
                    base: 'table-fixed border-separate border-spacing-0',
                    thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                    tbody: '[&>tr]:last:[&>td]:border-b-0',
                    th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                    td: 'border-b border-default',
                  }"
                />
              </div>
            </div>
          </template>

          <template #tab-performance>
            <div class="space-y-4 pt-4">
              <div v-if="performanceHints.length > 0" class="space-y-2">
                <div
                  v-for="(hint, index) in performanceHints"
                  :key="index"
                  :class="[
                    'p-3 rounded-lg border',
                    hint.type === 'warning'
                      ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800'
                      : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800',
                  ]"
                >
                  <div class="flex items-start gap-2">
                    <UIcon
                      :name="hint.type === 'warning' ? 'i-lucide-alert-triangle' : 'i-lucide-lightbulb'"
                      :class="hint.type === 'warning' ? 'text-amber-600' : 'text-blue-600'"
                      class="size-4 mt-0.5 shrink-0"
                    />
                    <div>
                      <p
                        :class="
                          hint.type === 'warning'
                            ? 'text-amber-800 dark:text-amber-200 font-medium'
                            : 'text-blue-800 dark:text-blue-200 font-medium'
                        "
                      >
                        {{ hint.message }}
                      </p>
                      <p
                        :class="
                          hint.type === 'warning'
                            ? 'text-amber-700 dark:text-amber-300'
                            : 'text-blue-700 dark:text-blue-300'
                        "
                        class="mt-1"
                      >
                        {{ hint.details }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <SectionCard v-if="webVitals" icon="i-lucide-gauge" title="Browser performance (Web Vitals)">
                <div class="space-y-4">
                  <div v-if="webVitals.navigation" class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p class="text-xs text-gray-500 uppercase tracking-wide">TTFB</p>
                      <p
                        class="text-xl font-semibold"
                        :class="
                          webVitals.navigation.ttfb > 600
                            ? 'text-red-600'
                            : webVitals.navigation.ttfb > 200
                              ? 'text-orange-500'
                              : 'text-green-600'
                        "
                      >
                        {{ formatDuration(webVitals.navigation.ttfb) }}
                      </p>
                      <p class="text-xs text-gray-400 mt-1">Time to first byte</p>
                    </div>
                    <div>
                      <p class="text-xs text-gray-500 uppercase tracking-wide">DOM Interactive</p>
                      <p
                        class="text-xl font-semibold"
                        :class="
                          webVitals.navigation.domInteractive > 3000
                            ? 'text-red-600'
                            : webVitals.navigation.domInteractive > 1500
                              ? 'text-orange-500'
                              : 'text-green-600'
                        "
                      >
                        {{ formatDuration(webVitals.navigation.domInteractive) }}
                      </p>
                      <p class="text-xs text-gray-400 mt-1">DOM interactive</p>
                    </div>
                    <div>
                      <p class="text-xs text-gray-500 uppercase tracking-wide">DOMContentLoaded</p>
                      <p
                        class="text-xl font-semibold"
                        :class="
                          webVitals.navigation.domContentLoaded > 3000
                            ? 'text-red-600'
                            : webVitals.navigation.domContentLoaded > 1500
                              ? 'text-orange-500'
                              : 'text-green-600'
                        "
                      >
                        {{ formatDuration(webVitals.navigation.domContentLoaded) }}
                      </p>
                      <p class="text-xs text-gray-400 mt-1">DOMContentLoaded</p>
                    </div>
                    <div>
                      <p class="text-xs text-gray-500 uppercase tracking-wide">Load Complete</p>
                      <p
                        class="text-xl font-semibold"
                        :class="
                          webVitals.navigation.loadComplete > 5000
                            ? 'text-red-600'
                            : webVitals.navigation.loadComplete > 3000
                              ? 'text-orange-500'
                              : 'text-green-600'
                        "
                      >
                        {{ formatDuration(webVitals.navigation.loadComplete) }}
                      </p>
                      <p class="text-xs text-gray-400 mt-1">Page fully loaded</p>
                    </div>
                  </div>

                  <div
                    v-if="webVitals.paint && (webVitals.paint.firstPaint || webVitals.paint.firstContentfulPaint)"
                    class="grid grid-cols-2 gap-4 pt-2 border-t"
                  >
                    <div v-if="webVitals.paint.firstPaint !== undefined">
                      <p class="text-xs text-gray-500 uppercase tracking-wide">First Paint (FP)</p>
                      <p class="text-xl font-semibold">
                        {{ formatDuration(webVitals.paint.firstPaint) }}
                      </p>
                    </div>
                    <div v-if="webVitals.paint.firstContentfulPaint !== undefined">
                      <p class="text-xs text-gray-500 uppercase tracking-wide">First Contentful Paint (FCP)</p>
                      <p
                        class="text-xl font-semibold"
                        :class="
                          webVitals.paint.firstContentfulPaint > 3000
                            ? 'text-red-600'
                            : webVitals.paint.firstContentfulPaint > 1800
                              ? 'text-orange-500'
                              : 'text-green-600'
                        "
                      >
                        {{ formatDuration(webVitals.paint.firstContentfulPaint) }}
                      </p>
                    </div>
                  </div>

                  <div v-if="webVitals.navigation?.url" class="text-xs text-gray-400 pt-1">
                    Page: <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ webVitals.navigation.url }}</code>
                  </div>
                </div>
              </SectionCard>
            </div>
          </template>

          <template #tab-traces>
            <div class="space-y-4 pt-4">
              <TestCaseTracesCard :traces="(traceData as any[]) || []" />
              <TestCaseAttachmentsCard :attachments="(testCase as any)?.attachments ?? []" />
              <TestCaseConsoleCard
                v-if="(testCase as any)?.consoleLogs?.length"
                :entries="(testCase as any)?.consoleLogs ?? []"
              />
              <SectionCard v-if="groupedNetworkRequests.length > 0" icon="i-lucide-network" title="Network requests">
                <div class="space-y-1 max-h-96 overflow-y-auto">
                  <div
                    v-for="req in groupedNetworkRequests"
                    :key="req.key"
                    class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <UBadge
                        :color="
                          req.method === 'GET'
                            ? 'info'
                            : req.method === 'POST'
                              ? 'success'
                              : req.method === 'DELETE'
                                ? 'error'
                                : 'warning'
                        "
                        variant="soft"
                        size="xs"
                        class="font-mono shrink-0"
                      >
                        {{ req.method }}
                      </UBadge>
                      <code class="truncate text-xs">{{ req.route }}</code>
                      <span v-if="req.count > 1" class="text-gray-400 text-xs shrink-0">&times;{{ req.count }}</span>
                    </div>
                    <span
                      class="ml-2 shrink-0"
                      :class="
                        req.avgDuration > 1000
                          ? 'text-red-600 font-medium'
                          : req.avgDuration > 500
                            ? 'text-orange-500'
                            : 'text-gray-500'
                      "
                      >{{ formatDuration(req.avgDuration) }}</span
                    >
                  </div>
                </div>
              </SectionCard>

              <SectionCard v-if="allServerLogs.length > 0" icon="i-lucide-server" title="Backend server logs">
                <div class="space-y-1 max-h-64 overflow-y-auto font-mono text-xs">
                  <div v-for="(log, i) in allServerLogs" :key="i" class="flex items-start gap-2 py-0.5">
                    <UBadge
                      :color="log.level === 'Error' ? 'error' : 'warning'"
                      variant="soft"
                      size="xs"
                      class="shrink-0 capitalize"
                      >{{ log.level }}</UBadge
                    >
                    <span v-if="log.category" class="text-gray-400 shrink-0">[{{ log.category }}]</span>
                    <span class="break-all text-gray-700 dark:text-gray-300">{{ log.message }}</span>
                  </div>
                </div>
              </SectionCard>

              <p
                v-else-if="groupedNetworkRequests.length > 0"
                class="flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500"
              >
                <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
                No backend server logs captured — install
                <a href="https://phenx.github.io/piwi-dashboard/backend-logs" target="_blank" class="underline"
                  >a Piwi backend integration</a
                >
                to see server-side warnings and errors here.
              </p>

              <div
                v-if="
                  !(traceData as any[])?.length &&
                  !(testCase as any)?.attachments?.length &&
                  !(testCase as any)?.consoleLogs?.length &&
                  !groupedNetworkRequests.length
                "
                class="flex flex-col items-center justify-center py-12 text-gray-400"
              >
                <template v-if="runIsActive">
                  <UIcon name="i-lucide-loader-circle" class="size-8 mb-2 animate-spin" />
                  <p class="text-sm">
                    Run in progress — traces and attachments appear here as soon as they are uploaded.
                  </p>
                </template>
                <template v-else>
                  <UIcon name="i-lucide-inbox" class="size-8 mb-2" />
                  <p class="text-sm">No traces, console logs, or network requests captured for this test case.</p>
                </template>
              </div>
            </div>
          </template>

          <template #tab-history>
            <div class="space-y-4 pt-4">
              <div v-if="historyData && historyData.length > 0">
                <div class="space-y-4">
                  <TestCaseHistoryChart :data="historyData" :height="200" />
                  <UTable
                    :data="historyData"
                    :columns="historyColumns"
                    :ui="{
                      base: 'table-fixed border-separate border-spacing-0',
                      thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                      tbody: '[&>tr]:last:[&>td]:border-b-0',
                      th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                      td: 'border-b border-default',
                    }"
                  />
                </div>
              </div>
            </div>
          </template>
        </DetailPageLayout>
      </template>
  </UDashboardPanel>
</template>
