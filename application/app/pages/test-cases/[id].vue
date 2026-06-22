<script setup lang="ts">
import type { TestCaseHistoryPoint } from '~~/types/api';
import type { TableColumn } from '@nuxt/ui';

const route = useRoute();
const testCaseId = route.params.id;

const { data: testCase, refresh } = await useFetch(`/api/test-cases/${testCaseId}`);
const { data: historyData } = await useFetch<TestCaseHistoryPoint[]>(`/api/test-cases/${testCaseId}/history`);

useHead(
  computed(() => ({
    title: `${testCase.value?.title || `Test case #${testCaseId}`} — Piwi Dashboard`,
  })),
);

const passRate = computed(() => {
  const t = testCase.value;
  if (!t || !t.totalRuns) return null;
  return Math.round(((t.passedRuns + t.skippedRuns) / t.totalRuns) * 100);
});

const clusterColor = (status: string) => {
  return status === 'open' ? 'error' : status === 'resolved' ? 'success' : 'neutral';
};

interface ExecutionRow {
  id: number;
  status: string;
  duration: number | null;
  error: string | null;
  retries: number | null;
  workerIndex: number | null;
  browser: unknown;
  runId: number;
  runStatus: string;
  runLabel: string | null;
  startTime: string | Date;
}

const executionColumns: TableColumn<ExecutionRow>[] = [
  {
    accessorKey: 'startTime',
    header: 'Date',
  },
  {
    accessorKey: 'status',
    header: 'Status',
  },
  {
    accessorKey: 'duration',
    header: 'Duration',
  },
  {
    accessorKey: 'retries',
    header: 'Retries',
  },
  {
    accessorKey: 'runId',
    header: 'Run',
  },
  {
    accessorKey: 'error',
    header: 'Error',
  },
  {
    id: 'actions',
    header: 'Actions',
  },
];
</script>

<template>
  <UDashboardPanel id="test-case-evolution">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              ...(testCase?.project?.id
                ? [
                    {
                      label: testCase.project.name || 'Project',
                      to: `/projects/${testCase.project.id}`,
                    },
                  ]
                : [{ label: 'Project' }]),
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
      <div class="flex flex-col gap-4 p-4">
        <!-- Header -->
        <div class="flex items-start gap-4 flex-wrap">
          <div class="flex-1 min-w-0">
            <h1 class="text-xl font-bold truncate">{{ testCase?.title }}</h1>
            <p v-if="testCase?.filePath" class="text-sm text-gray-500 font-mono mt-0.5">{{ testCase.filePath }}</p>
            <div v-if="testCase?.project" class="flex items-center gap-2 mt-2">
              <UBadge color="neutral" variant="soft" size="xs" class="font-mono">
                {{ testCase.project.name }}
              </UBadge>
              <UBadge v-if="testCase?.flakyRuns > 0" color="warning" variant="soft" size="xs">
                {{ testCase.flakyRuns }} flaky run{{ testCase.flakyRuns === 1 ? '' : 's' }}
              </UBadge>
            </div>
          </div>
          <NuxtLink
            v-if="testCase?.lastExecutionId"
            :to="`/test-run-cases/${testCase.lastExecutionId}`"
            class="shrink-0"
          >
            <UButton size="sm" variant="outline" trailing-icon="i-lucide-arrow-right"> Latest execution </UButton>
          </NuxtLink>
        </div>

        <!-- Stats cards -->
        <div class="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Total runs</p>
            <p class="text-xl font-bold mt-0.5">{{ testCase?.totalRuns ?? 0 }}</p>
          </div>
          <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Pass rate</p>
            <p
              class="text-xl font-bold mt-0.5"
              :class="{
                'text-green-600': (passRate ?? 0) >= 80,
                'text-yellow-600': (passRate ?? 0) >= 50 && (passRate ?? 0) < 80,
                'text-red-600': (passRate ?? 0) < 50,
              }"
            >
              {{ passRate !== null ? `${passRate}%` : '—' }}
            </p>
          </div>
          <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Failed</p>
            <p class="text-xl font-bold mt-0.5 text-red-600">{{ testCase?.failedRuns ?? 0 }}</p>
          </div>
          <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Avg duration</p>
            <p class="text-xl font-bold mt-0.5">
              {{ testCase?.avgDuration != null ? formatDuration(testCase.avgDuration) : '—' }}
            </p>
          </div>
          <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Flaky</p>
            <p class="text-xl font-bold mt-0.5" :class="(testCase?.flakyRuns ?? 0) > 0 ? 'text-purple-600' : ''">
              {{ testCase?.flakyRuns ?? 0 }}
            </p>
          </div>
          <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">Last run</p>
            <p class="text-sm font-semibold mt-0.5">
              {{ testCase?.lastRunAt ? formatRelativeTime(testCase.lastRunAt) : '—' }}
            </p>
          </div>
        </div>

        <!-- Evolution charts -->
        <div v-if="historyData && historyData.length > 1" class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-trending-up" class="size-4 text-primary" />
                <span class="text-sm font-medium">Duration trend</span>
              </div>
            </template>
            <TestCaseHistoryChart :data="historyData" :height="200" />
          </UCard>

          <UCard>
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-check-circle" class="size-4 text-primary" />
                <span class="text-sm font-medium">Status history</span>
              </div>
            </template>
            <div class="flex items-center gap-1 flex-wrap max-h-[200px] overflow-y-auto py-1">
              <UTooltip
                v-for="(point, i) in historyData"
                :key="point.id"
                :text="`Run #${point.runId}: ${point.status} — ${new Date(point.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`"
              >
                <NuxtLink
                  :to="`/test-run-cases/${point.id}`"
                  :class="{
                    'bg-red-500 hover:bg-red-600': point.status === 'failed' || point.status === 'timedOut',
                    'bg-green-500 hover:bg-green-600': point.status === 'passed',
                    'bg-yellow-500 hover:bg-yellow-600': point.status === 'skipped',
                    'bg-gray-400 hover:bg-gray-500': !['passed', 'failed', 'skipped', 'timedOut'].includes(
                      point.status,
                    ),
                  }"
                  class="size-3.5 rounded-sm inline-block transition-colors"
                  :title="`Run #${point.runId}: ${point.status}`"
                />
              </UTooltip>
              <span v-if="historyData.length === 0" class="text-sm text-gray-400">No history yet</span>
            </div>
          </UCard>
        </div>

        <div v-else-if="historyData && historyData.length <= 1" class="text-center py-6 text-gray-400">
          <UIcon name="i-lucide-trending-up" class="size-6 mx-auto mb-1" />
          <p class="text-sm">Need at least 2 runs to show trends.</p>
        </div>

        <!-- Recent executions -->
        <SectionCard
          icon="i-lucide-list-checks"
          :title="`Recent executions (${testCase?.recentExecutions?.length ?? 0})`"
        >
          <UTable
            v-if="testCase?.recentExecutions?.length"
            :data="testCase.recentExecutions"
            :columns="executionColumns"
            :ui="{
              base: 'table-fixed border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default',
            }"
          >
            <template #startTime-cell="{ row }">
              <span class="text-xs whitespace-nowrap">
                <span class="text-gray-500">{{
                  new Date(row.original.startTime).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
                }}</span>
                <span class="text-gray-400 ml-1">{{
                  new Date(row.original.startTime).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })
                }}</span>
              </span>
            </template>
            <template #status-cell="{ row }">
              <UBadge :color="getStatusColor(row.original.status)" class="capitalize">{{ row.original.status }}</UBadge>
            </template>
            <template #duration-cell="{ row }">
              <span v-if="row.original.duration !== null">{{ formatDuration(row.original.duration) }}</span>
              <span v-else class="text-gray-400">&mdash;</span>
            </template>
            <template #retries-cell="{ row }">
              {{ row.original.retries && row.original.retries > 0 ? row.original.retries : '' }}
            </template>
            <template #runId-cell="{ row }">
              <NuxtLink :to="`/test-runs/${row.original.runId}`" class="text-primary hover:underline">
                {{
                  row.original.runLabel ? `${row.original.runLabel} (#${row.original.runId})` : `#${row.original.runId}`
                }}
              </NuxtLink>
            </template>
            <template #error-cell="{ row }">
              <span
                v-if="row.original.error"
                class="text-red-600 text-xs truncate max-w-xs block"
                :title="row.original.error"
              >
                {{ row.original.error.length > 80 ? `${row.original.error.substring(0, 80)}…` : row.original.error }}
              </span>
            </template>
            <template #actions-header>
              <div class="text-right">Actions</div>
            </template>
            <template #actions-cell="{ row }">
              <div class="flex justify-end">
                <UButton
                  :to="`/test-run-cases/${row.original.id}`"
                  size="sm"
                  variant="outline"
                  trailing-icon="i-lucide-arrow-right"
                >
                  View
                </UButton>
              </div>
            </template>
          </UTable>
          <EmptyState v-else icon="i-lucide-inbox" text="No executions yet" />
        </SectionCard>

        <!-- Failure clusters -->
        <SectionCard
          v-if="testCase?.failureClusters?.length"
          icon="i-lucide-bug"
          :title="`Failure clusters (${testCase.failureClusters.length})`"
        >
          <div class="space-y-2">
            <div
              v-for="cluster in testCase.failureClusters"
              :key="cluster.id"
              class="flex items-center justify-between py-2 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800"
            >
              <div class="flex items-center gap-2 min-w-0">
                <UBadge :color="clusterColor(cluster.status)" variant="soft" size="xs" class="capitalize">
                  {{ cluster.status }}
                </UBadge>
                <span class="text-sm truncate">{{ cluster.signature }}</span>
                <span v-if="cluster.occurrences > 1" class="text-xs text-gray-400 shrink-0">
                  {{ cluster.occurrences }} occurrences
                </span>
              </div>
              <UButton
                :to="`/failure-clusters/${cluster.id}`"
                size="xs"
                variant="outline"
                trailing-icon="i-lucide-arrow-right"
              >
                View
              </UButton>
            </div>
          </div>
        </SectionCard>

        <!-- Entity links -->
        <SectionCard v-if="testCase?.links?.length" icon="i-lucide-link" title="Links">
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
