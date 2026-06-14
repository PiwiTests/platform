<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui';
import type { TestCaseWithStats, ProjectDetails } from '~~/types/api';

const route = useRoute();
const projectId = route.params.id;

const { data: testCases, refresh } = await useFetch<TestCaseWithStats[]>(`/api/projects/${projectId}/test-cases`);
const { data: project } = await useFetch<ProjectDetails>(`/api/projects/${projectId}`);

useHead(
  computed(() => ({
    title: `${project.value?.label || project.value?.name || 'Project'} — Test cases — Piwi Dashboard`,
  })),
);

function getPassRate(testCase: TestCaseWithStats) {
  if (testCase.totalRuns === 0) return 0;
  return Math.round((testCase.passedRuns / testCase.totalRuns) * 100);
}

type BadgeColor = 'error' | 'neutral' | 'primary' | 'success' | 'warning' | 'secondary' | 'info';

function getTestCaseStatus(testCase: TestCaseWithStats): { status: string; color: BadgeColor } {
  const recentFlaky = testCase.recentFlakyRuns ?? testCase.flakyRuns;
  if (recentFlaky > 0) {
    return { status: 'flaky', color: 'warning' };
  }
  return {
    status: testCase.lastStatus || 'unknown',
    color: getStatusColor(testCase.lastStatus || 'unknown') as BadgeColor,
  };
}

const testCasesColumns: TableColumn<TestCaseWithStats>[] = [
  { accessorKey: 'title', header: createSortHeader<TestCaseWithStats>('Test case') },
  { accessorKey: 'status', header: createSortHeader<TestCaseWithStats>('Status') },
  { accessorKey: 'totalRuns', header: createSortHeader<TestCaseWithStats>('Runs') },
  { accessorKey: 'passRate', header: createSortHeader<TestCaseWithStats>('Pass rate') },
  { accessorKey: 'results', header: 'Results' },
  { accessorKey: 'avgDuration', header: createSortHeader<TestCaseWithStats>('Avg duration') },
  { accessorKey: 'lastRun', header: createSortHeader<TestCaseWithStats>('Last run') },
  { id: 'actions', header: 'Actions' },
];
</script>

<template>
  <UDashboardPanel id="project-test-cases">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project', to: `/projects/${projectId}` },
              { label: 'Test cases' },
            ]"
          />
        </template>
        <template #right>
          <UButton icon="i-lucide-refresh-cw" size="md" label="Refresh" @click="() => refresh()" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-4">
        <UCard>
          <template #header>
            <h2>Test cases</h2>
            <p class="text-sm text-gray-600 mt-1">
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
              td: 'border-b border-default',
            }"
          >
            <template #actions-header>
              <div class="text-right">Actions</div>
            </template>

            <template #title-cell="{ row }">
              <div class="min-w-0 space-y-0.5">
                <NuxtLink
                  :to="`/test-cases/${row.original.id}`"
                  class="font-medium text-primary hover:underline truncate block"
                  :title="row.original.title"
                >
                  {{ row.original.title }}
                </NuxtLink>
                <div class="flex items-center gap-1 text-xs text-gray-400">
                  <UIcon name="i-lucide-file-code" class="size-3 shrink-0" />
                  <span class="font-mono truncate">{{ row.original.filePath }}</span>
                </div>
              </div>
            </template>

            <template #status-cell="{ row }">
              <UBadge :color="getTestCaseStatus(row.original).color" variant="subtle" class="capitalize" size="sm">
                {{ getTestCaseStatus(row.original).status }}
              </UBadge>
            </template>

            <template #totalRuns-cell="{ row }">
              <span class="tabular-nums text-sm">{{ row.original.totalRuns }}</span>
            </template>

            <template #passRate-cell="{ row }">
              <span
                class="font-medium text-sm tabular-nums"
                :class="{
                  'text-green-600': getPassRate(row.original) >= 80,
                  'text-yellow-600': getPassRate(row.original) >= 50 && getPassRate(row.original) < 80,
                  'text-red-600': getPassRate(row.original) < 50,
                }"
              >
                {{ getPassRate(row.original) }}%
              </span>
            </template>

            <template #results-cell="{ row }">
              <div class="flex items-center gap-2.5 text-sm">
                <span class="flex items-center gap-0.5 text-green-600">
                  <UIcon name="i-lucide-check" class="size-3.5" />
                  <span class="tabular-nums">{{ row.original.passedRuns }}</span>
                </span>
                <span class="flex items-center gap-0.5 text-red-600">
                  <UIcon name="i-lucide-x" class="size-3.5" />
                  <span class="tabular-nums">{{ row.original.failedRuns }}</span>
                </span>
                <span v-if="row.original.flakyRuns > 0" class="flex items-center gap-0.5 text-purple-600">
                  <UIcon name="i-lucide-refresh-cw" class="size-3" />
                  <span class="tabular-nums">{{ row.original.flakyRuns }}</span>
                </span>
                <span v-if="row.original.skippedRuns > 0" class="flex items-center gap-0.5 text-gray-400">
                  <UIcon name="i-lucide-minus" class="size-3.5" />
                  <span class="tabular-nums">{{ row.original.skippedRuns }}</span>
                </span>
              </div>
            </template>

            <template #avgDuration-cell="{ row }">
              <span class="text-sm text-gray-600">{{ formatDuration(row.original.avgDuration) }}</span>
            </template>

            <template #lastRun-cell="{ row }">
              <span class="text-xs text-gray-500">{{ prettyDateFormat(row.original.lastRun) }}</span>
            </template>

            <template #actions-cell="{ row }">
              <div class="flex justify-end">
                <UButton
                  :to="`/test-cases/${row.original.id}`"
                  size="sm"
                  variant="outline"
                  trailing-icon="i-lucide-arrow-right"
                >
                  View
                </UButton>
              </div>
            </template>
          </UTable>

          <div v-else class="text-center py-8 text-gray-500">No test cases yet for this project.</div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
