<script setup lang="ts">
import { describeCluster } from '#shared/describe-cluster';
import type { TestCaseHistoryPoint, MarkerInfo, MarkersResponse } from '~~/types/api';
import { CASE_STATUS_SERIES, legendOf } from '~/utils/chart';

const route = useRoute();
const testCaseId = route.params.id;

const { data: testCase, refresh } = await useFetch(`/api/test-cases/${testCaseId}`);
const { data: historyData } = await useFetch(`/api/test-cases/${testCaseId}/history`, {
  transform: (r: { items: TestCaseHistoryPoint[] }) => r.items,
});

// Project timeline markers, overlaid on the history chart for context.
const historyMarkers = ref<MarkerInfo[]>([]);
watch(
  () => testCase.value?.project?.id,
  async (pid) => {
    if (!pid) return;
    try {
      historyMarkers.value = (await $fetch<MarkersResponse>(`/api/projects/${pid}/markers`)).items ?? [];
    } catch {
      // markers are optional context
    }
  },
  { immediate: true },
);
function goToProjectRuns() {
  const pid = testCase.value?.project?.id;
  if (pid) navigateTo(`/projects/${pid}?tab=runs`);
}

useHead(
  computed(() => ({
    title: `${testCase.value?.title || `Test #${testCaseId}`} — Piwi Dashboard`,
  })),
);

const passRate = computed(() => {
  const t = testCase.value;
  if (!t || !t.totalRuns) return null;
  return Math.round(((t.passedRuns + t.skippedRuns) / t.totalRuns) * 100);
});

// Desktop shell: reproduce this test on this machine. Selected by title so no
// line number is needed; repeat ×20 with a trace is the flake-hunting preset.
const reproduceCases = computed(() =>
  testCase.value?.filePath ? [{ filePath: testCase.value.filePath, title: testCase.value.title, line: null }] : [],
);

const clusterColor = (status: string) => {
  return status === 'open' ? 'error' : status === 'resolved' ? 'success' : 'neutral';
};

const passRateClass = computed(() => {
  const r = passRate.value ?? 0;
  return r >= 80
    ? 'text-green-600 dark:text-green-400'
    : r >= 50
      ? 'text-yellow-600 dark:text-yellow-400'
      : 'text-red-600 dark:text-red-400';
});
</script>

<template>
  <UDashboardPanel id="test-case-evolution">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              ...(testCase?.project?.id
                ? [
                    {
                      label: testCase.project.label || testCase.project.name || 'Project',
                      to: `/projects/${testCase.project.id}`,
                    },
                  ]
                : [{ label: 'Project' }]),
              { label: testCase?.title || `Test #${testCaseId}` },
            ]"
          />
        </template>
        <template #right>
          <NavbarActions :actions="[{ label: 'Refresh', icon: 'i-lucide-refresh-cw', onClick: () => refresh() }]" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="flex flex-col gap-4 p-4" data-shot="test-case-detail">
        <!-- Header: title, a single facts line, and the two actions. The title
             wraps and the actions drop below it on phones. -->
        <div class="flex flex-col gap-3 sm:flex-row sm:items-start sm:gap-4">
          <div class="flex-1 min-w-0 space-y-2">
            <h1 class="text-xl font-bold break-words">{{ testCase?.title }}</h1>
            <OpenInIdeLink
              v-if="testCase?.filePath"
              :file-path="testCase.filePath"
              :project-key="testCase?.project?.id"
              :project-name="testCase?.project?.name"
              class="text-sm text-gray-500"
            />
            <UBadge v-if="testCase?.project" color="neutral" variant="soft" size="xs" class="font-mono">
              {{ testCase.project.label ?? testCase.project.name }}
            </UBadge>

            <TestMetaBadges
              v-if="testCase?.tags?.length || testCase?.locks?.length"
              :tags="testCase?.tags"
              :locks="testCase?.locks"
            />

            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span class="tabular-nums">
                <strong class="text-highlighted">{{ testCase?.totalRuns ?? 0 }}</strong> runs
              </span>
              <span aria-hidden class="opacity-40">·</span>
              <span class="tabular-nums">
                <strong :class="passRateClass">{{ passRate !== null ? `${passRate}%` : '—' }}</strong> pass
              </span>
              <span aria-hidden class="opacity-40">·</span>
              <span class="tabular-nums">
                <strong class="text-red-600 dark:text-red-400">{{ testCase?.failedRuns ?? 0 }}</strong> failed
              </span>
              <span aria-hidden class="opacity-40">·</span>
              <span class="inline-flex items-center gap-1">
                avg <DurationValue :ms="testCase?.avgDuration" class="text-highlighted" />
              </span>
              <span aria-hidden class="opacity-40">·</span>
              <span class="tabular-nums">
                <strong
                  :class="(testCase?.flakyRuns ?? 0) > 0 ? 'text-purple-600 dark:text-purple-400' : 'text-highlighted'"
                >
                  {{ testCase?.flakyRuns ?? 0 }}
                </strong>
                flaky
              </span>
              <span aria-hidden class="opacity-40">·</span>
              <span>last run {{ testCase?.lastRunAt ? formatRelativeTime(testCase.lastRunAt) : '—' }}</span>
            </div>
          </div>

          <div class="flex flex-wrap items-center gap-2 shrink-0">
            <DesktopRunLocallyButton
              :project-id="testCase?.project?.id"
              :project-label="testCase?.project?.label ?? testCase?.project?.name"
              :cases="reproduceCases"
              label="Reproduce locally"
              :preset-options="{ mode: 'grep', repeatEach: 20, trace: true }"
            />
            <NuxtLink v-if="testCase?.lastExecutionId" :to="`/test-run-cases/${testCase.lastExecutionId}`">
              <UButton size="sm" variant="outline" trailing-icon="i-lucide-arrow-right">Latest execution</UButton>
            </NuxtLink>
          </div>
        </div>

        <!-- Duration trend, with the execution strip as its footer row -->
        <ChartCard
          v-if="historyData && historyData.length"
          title="Duration trend"
          icon="i-lucide-trending-up"
          help="case.history-chart"
          :legend="historyData.length > 1 ? legendOf(CASE_STATUS_SERIES) : undefined"
        >
          <TestCaseHistoryChart
            v-if="historyData.length > 1"
            :data="historyData"
            :height="200"
            :markers="historyMarkers"
            @marker-click="goToProjectRuns"
          />
          <p v-else class="text-center py-4 text-sm text-gray-400">Need at least 2 runs to show a trend.</p>

          <template #footer>
            <HistoryStrip :history="historyData" compact />
          </template>
        </ChartCard>

        <!-- Recent executions -->
        <SectionCard
          icon="i-lucide-list-checks"
          :title="`Recent executions (${testCase?.recentExecutions?.length ?? 0})`"
        >
          <div v-if="testCase?.recentExecutions?.length" class="rounded-lg border border-default overflow-hidden">
            <TestRow
              v-for="exec in testCase.recentExecutions"
              :key="exec.id"
              :href="`/test-run-cases/${exec.id}`"
              :title="formatRelativeTime(exec.startTime)"
              :status="exec.status"
              :error="exec.error"
              :project-key="testCase?.project?.id"
              :project-name="testCase?.project?.name"
            >
              <template #metrics>
                <DurationValue v-if="exec.duration !== null" :ms="exec.duration" />
                <UBadge
                  v-if="exec.retries && exec.retries > 0"
                  color="warning"
                  variant="soft"
                  size="xs"
                  :title="`${exec.retries + 1} attempts`"
                >
                  {{ exec.retries + 1 }} attempts
                </UBadge>
                <NuxtLink :to="`/test-runs/${exec.runId}`" class="text-primary hover:underline shrink-0" @click.stop>
                  {{ exec.runLabel ? `${exec.runLabel} (#${exec.runId})` : `run #${exec.runId}` }}
                </NuxtLink>
              </template>
            </TestRow>
          </div>
          <EmptyState v-else icon="i-lucide-inbox" text="No executions yet" />
        </SectionCard>

        <!-- Failure clusters -->
        <SectionCard
          v-if="testCase?.failureClusters?.length"
          icon="i-lucide-bug"
          :title="`Failure clusters (${testCase.failureClusters.length})`"
          help="cluster.concept"
        >
          <div class="space-y-1">
            <NuxtLink
              v-for="cluster in testCase.failureClusters"
              :key="cluster.id"
              :to="`/failure-clusters/${cluster.id}`"
              class="flex items-center gap-2 py-2 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <UBadge :color="clusterColor(cluster.status)" variant="soft" size="xs" class="shrink-0">
                {{ formatTriageStatus(cluster.status) }}
              </UBadge>
              <span class="text-sm truncate min-w-0" :title="cluster.signature">{{ describeCluster(cluster) }}</span>
              <span v-if="cluster.occurrences > 1" class="text-xs text-gray-400 shrink-0">
                {{ cluster.occurrences }} occurrences
              </span>
              <UIcon name="i-lucide-arrow-right" class="size-3.5 text-muted shrink-0 ml-auto" />
            </NuxtLink>
          </div>
        </SectionCard>

        <!-- Entity links -->
        <SectionCard v-if="testCase?.links?.length" icon="i-lucide-link" title="Links" help="shared.entity-links">
          <EntityLinks
            entity-type="test_case"
            :entity-id="Number(testCaseId)"
            :links="(testCase.links as any) ?? null"
          />
        </SectionCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
