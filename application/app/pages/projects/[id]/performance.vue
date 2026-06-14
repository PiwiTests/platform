<script setup lang="ts">
import { h, resolveComponent } from 'vue';
import type { TableColumn } from '@nuxt/ui';
import type { PerformanceTrendPoint, SlowTest, TestRunForCompare, ProjectDetails } from '~~/types/api';
import { useRunComparison } from '~/composables/useRunComparison';
import type { ComparisonRow } from '~/composables/useRunComparison';

const route = useRoute();
const projectId = route.params.id;

const { data: project } = await useFetch<ProjectDetails>(`/api/projects/${projectId}`);

// Date range filter
const dateFrom = ref('');
const dateTo = ref('');

const performanceQueryParams = computed(() => {
  const params: Record<string, string> = {};
  if (dateFrom.value) params.from = dateFrom.value;
  if (dateTo.value) params.to = dateTo.value;
  return params;
});

const { data: performanceData, refresh: refreshPerformance } = await useFetch<PerformanceTrendPoint[]>(
  () => `/api/projects/${projectId}/performance`,
  { query: performanceQueryParams },
);
const { data: slowTests, refresh: refreshSlowTests } = await useFetch<SlowTest[]>(
  `/api/projects/${projectId}/slow-tests`,
);

useHead(
  computed(() => ({
    title: `${project.value?.label || project.value?.name || 'Project'} — Performance — Piwi Dashboard`,
  })),
);

const UBadge = resolveComponent('UBadge');

// Slow tests table columns
const slowTestsColumns: TableColumn<SlowTest>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<SlowTest>('Test case'),
    cell: ({ row }) => {
      return h('div', {}, [
        h('div', { class: 'font-medium' }, row.getValue('title')),
        h('code', { class: 'text-xs bg-gray-100 dark:bg-gray-800 p-1 rounded mt-1 block' }, row.original.filePath),
      ]);
    },
  },
  {
    accessorKey: 'avgDuration',
    header: createSortHeader<SlowTest>('Avg duration'),
    cell: ({ row }) => formatDuration(row.getValue('avgDuration')),
  },
  {
    accessorKey: 'maxDuration',
    header: createSortHeader<SlowTest>('Max'),
    cell: ({ row }) => formatDuration(row.getValue('maxDuration')),
  },
  {
    accessorKey: 'minDuration',
    header: createSortHeader<SlowTest>('Min'),
    cell: ({ row }) => formatDuration(row.getValue('minDuration')),
  },
  {
    accessorKey: 'latestDuration',
    header: createSortHeader<SlowTest>('Latest'),
    cell: ({ row }) => formatDuration(row.getValue('latestDuration')),
  },
  {
    accessorKey: 'trend',
    header: createSortHeader<SlowTest>('Trend'),
    cell: ({ row }) => {
      const trend = row.getValue('trend') as string;
      if (trend === 'slower') return h('span', { class: 'text-red-600 font-medium' }, '▲ Slower');
      if (trend === 'faster') return h('span', { class: 'text-green-600 font-medium' }, '▼ Faster');
      return h('span', { class: 'text-gray-500' }, '— Stable');
    },
  },
  {
    accessorKey: 'runCount',
    header: createSortHeader<SlowTest>('Runs'),
    cell: ({ row }) => row.getValue('runCount'),
  },
];

// ---- Run Comparison Feature ----
function formatRunLabel(run: PerformanceTrendPoint): string {
  const date = prettyDateFormat(run.startTime, { dateOnly: true });
  const commitSuffix = run.commit ? ` (${run.commit.substring(0, 7)})` : '';
  return `Run #${run.id} — ${date}${commitSuffix}`;
}

interface RunOption {
  label: string;
  value: number;
}

const runOptions = computed<RunOption[]>(() => {
  if (!performanceData.value) return [];
  return [...performanceData.value].reverse().map((run) => ({
    label: formatRunLabel(run),
    value: run.id,
  }));
});

// Use full option objects — avoids USelectMenu value-key binding issues
const selectedRunOptionA = ref<RunOption | undefined>(undefined);
const selectedRunOptionB = ref<RunOption | undefined>(undefined);

// Support pre-selecting runs from query params (e.g. from project detail checkboxes)
const queryRunA = computed(() => (route.query.runA ? Number(route.query.runA) : null));
const queryRunB = computed(() => (route.query.runB ? Number(route.query.runB) : null));

watch(
  runOptions,
  (options) => {
    if (queryRunA.value) {
      const match = options.find((o) => o.value === queryRunA.value);
      if (match) selectedRunOptionA.value = match;
    }
    if (queryRunB.value) {
      const match = options.find((o) => o.value === queryRunB.value);
      if (match) selectedRunOptionB.value = match;
    }
  },
  { immediate: true },
);

// Quick "compare latest vs previous" action
function compareLatestWithPrevious() {
  if (runOptions.value.length >= 2) {
    selectedRunOptionA.value = runOptions.value[1]; // previous (2nd newest)
    selectedRunOptionB.value = runOptions.value[0]; // latest (newest)
  }
}

const runADetails = ref<TestRunForCompare | null>(null);
const runBDetails = ref<TestRunForCompare | null>(null);
const loading = ref(false);

async function fetchBothRuns() {
  const optA = selectedRunOptionA.value;
  const optB = selectedRunOptionB.value;
  if (!optA?.value && !optB?.value) return;
  loading.value = true;
  try {
    const ids: number[] = [];
    if (optA?.value) ids.push(optA.value);
    if (optB?.value) ids.push(optB.value);
    const results = await Promise.all(ids.map((id) => $fetch<TestRunForCompare>(`/api/test-runs/${id}/summary`)));
    const map = new Map<number, TestRunForCompare>();
    for (const r of results) map.set(r.id, r);
    runADetails.value = optA?.value ? (map.get(optA.value) ?? null) : null;
    runBDetails.value = optB?.value ? (map.get(optB.value) ?? null) : null;
  } catch {
    runADetails.value = null;
    runBDetails.value = null;
  } finally {
    loading.value = false;
  }
}

watch([selectedRunOptionA, selectedRunOptionB], () => {
  fetchBothRuns();
});

const { comparisonData, comparisonSummary } = useRunComparison(runADetails, runBDetails);

const comparisonColumns: TableColumn<ComparisonRow>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<ComparisonRow>('Test case'),
    cell: ({ row }) => h('span', { class: 'font-medium' }, row.getValue('title')),
  },
  {
    accessorKey: 'durationA',
    header: createSortHeader<ComparisonRow>('Run A'),
    cell: ({ row }) => {
      const val = row.getValue('durationA') as number | null;
      return val !== null ? formatDuration(val) : h('span', { class: 'text-gray-400' }, '—');
    },
  },
  {
    accessorKey: 'durationB',
    header: createSortHeader<ComparisonRow>('Run B'),
    cell: ({ row }) => {
      const val = row.getValue('durationB') as number | null;
      return val !== null ? formatDuration(val) : h('span', { class: 'text-gray-400' }, '—');
    },
  },
  {
    accessorKey: 'delta',
    header: createSortHeader<ComparisonRow>('Delta'),
    cell: ({ row }) => {
      const delta = row.getValue('delta') as number | null;
      if (delta === null) return h('span', { class: 'text-gray-400' }, '—');
      const sign = delta > 0 ? '+' : '';
      const color = delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-500';
      return h('span', { class: color }, `${sign}${formatDuration(delta)}`);
    },
  },
  {
    accessorKey: 'percentChange',
    header: createSortHeader<ComparisonRow>('Change'),
    cell: ({ row }) => {
      const pct = row.getValue('percentChange') as number | null;
      if (pct === null) return h('span', { class: 'text-gray-400' }, '—');
      const sign = pct > 0 ? '+' : '';
      const color = pct > 10 ? 'text-red-600 font-medium' : pct < -10 ? 'text-green-600 font-medium' : 'text-gray-500';
      return h('span', { class: color }, `${sign}${pct}%`);
    },
  },
];

function refresh() {
  refreshPerformance();
  refreshSlowTests();
}
</script>

<template>
  <UDashboardPanel id="project-performance">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project', to: `/projects/${projectId}` },
              { label: 'Performance' },
            ]"
          />
        </template>
        <template #right>
          <UButton icon="i-lucide-refresh-cw" size="md" label="Refresh" @click="refresh" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-6">
        <!-- Date Range Filter -->
        <div class="flex flex-wrap items-center gap-3">
          <span class="text-sm text-muted shrink-0">Date range:</span>
          <UInput v-model="dateFrom" type="date" size="sm" placeholder="From" class="w-40" />
          <span class="text-sm text-muted">to</span>
          <UInput v-model="dateTo" type="date" size="sm" placeholder="To" class="w-40" />
          <UButton
            v-if="dateFrom || dateTo"
            size="xs"
            variant="ghost"
            color="neutral"
            icon="i-lucide-x"
            label="Clear"
            @click="
              dateFrom = '';
              dateTo = '';
            "
          />
        </div>

        <!-- Performance Trend Chart -->
        <UCard>
          <template #header>
            <h2>Performance trend</h2>
            <p class="text-sm text-gray-600 mt-1">Duration metrics over time</p>
          </template>

          <PerformanceTrendChart :data="performanceData || []" :height="350" />
        </UCard>

        <!-- Slowest Tests -->
        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">Slowest tests</h2>
            <p class="text-sm text-gray-600 mt-1">Top 20 slowest test cases across recent runs</p>
          </template>

          <UTable
            v-if="slowTests && slowTests.length > 0"
            :data="slowTests"
            :columns="slowTestsColumns"
            :ui="{
              base: 'table-fixed border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default',
            }"
          />

          <div v-else class="text-center py-8 text-gray-500">No slow test data available yet.</div>
        </UCard>

        <!-- Run Comparison -->
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-xl font-semibold">Run comparison</h2>
                <p class="text-sm text-gray-600 mt-1">Compare duration changes between two runs</p>
              </div>
              <UButton
                v-if="runOptions.length >= 2"
                icon="i-lucide-git-compare-arrows"
                size="sm"
                variant="outline"
                label="Compare latest vs previous"
                @click="compareLatestWithPrevious"
              />
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run A (baseline)</label>
                <USelectMenu v-model="selectedRunOptionA" :items="runOptions" placeholder="Select run A..." />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1"
                  >Run B (comparison)</label
                >
                <USelectMenu v-model="selectedRunOptionB" :items="runOptions" placeholder="Select run B..." />
              </div>
            </div>

            <!-- Loading states -->
            <div v-if="loading" class="text-center py-4 text-gray-500">
              <UIcon name="i-lucide-loader-2" class="animate-spin mr-2" />
              Loading run data…
            </div>

            <!-- Comparison Summary -->
            <div v-else-if="selectedRunOptionA && selectedRunOptionB && comparisonData.length > 0" class="space-y-4">
              <div class="flex gap-4 text-sm">
                <UBadge color="success" variant="soft" size="lg"> {{ comparisonSummary.improved }} improved </UBadge>
                <UBadge color="error" variant="soft" size="lg"> {{ comparisonSummary.regressed }} regressed </UBadge>
                <UBadge color="neutral" variant="soft" size="lg"> {{ comparisonSummary.unchanged }} unchanged </UBadge>
              </div>

              <UTable
                :data="comparisonData"
                :columns="comparisonColumns"
                :ui="{
                  base: 'table-fixed border-separate border-spacing-0',
                  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                  tbody: '[&>tr]:last:[&>td]:border-b-0',
                  th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                  td: 'border-b border-default',
                }"
              />
            </div>

            <div v-else-if="!selectedRunOptionA || !selectedRunOptionB" class="text-center py-8 text-gray-500">
              Select two runs to compare their performance.
            </div>

            <div v-else class="text-center py-8 text-gray-500">
              No overlapping test cases found between the selected runs.
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
