<script setup lang="ts">
import { h, resolveComponent, computed, ref, onMounted } from 'vue';
import type { TableColumn } from '@nuxt/ui';
import type { TestRunDetails, ProjectWithTestRuns } from '~~/types/api';
import type { ComparisonRow } from '~/composables/useRunComparison';

interface RunOption {
  label: string;
  value: number;
}

const route = useRoute();
const runId = route.params.id;

const testRun = ref<TestRunDetails | null>(null);
const projectData = ref<ProjectWithTestRuns | null>(null);
const loadingRun = ref(true);

const isLive = computed(() => testRun.value?.status === 'running');

onMounted(async () => {
  try {
    const data = await $fetch<TestRunDetails>(`/api/test-runs/${runId}`);
    testRun.value = data;
    if (data?.projectId) {
      projectData.value = await $fetch<ProjectWithTestRuns>(`/api/projects/${data.projectId}`);
    }
  } catch (e) {
    console.error('Failed to fetch data for RunCompare', e);
  } finally {
    loadingRun.value = false;
  }
});

const projectRunOptions = computed<RunOption[]>(() => {
  if (!projectData.value?.testRuns) return [];
  return projectData.value.testRuns
    .filter((r) => r.id !== Number(runId))
    .slice(0, 50)
    .map((r) => ({
      label: `Run #${r.id} — ${prettyDateFormat(r.startTime, { dateOnly: true })} (${r.status})`,
      value: r.id,
    }));
});

const previousRunId = computed<number | null>(() => {
  if (!projectData.value?.testRuns) return null;
  const sorted = [...projectData.value.testRuns].sort(
    (a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
  );
  const currentIdx = sorted.findIndex((r) => r.id === Number(runId));
  if (currentIdx >= 0 && currentIdx < sorted.length - 1) {
    return sorted[currentIdx + 1]!.id;
  }
  return null;
});

const compareRunA = ref<RunOption | undefined>(undefined);
const baselineRun = ref<TestRunDetails | null>(null);
const loadingBaseline = ref(false);

watch(compareRunA, async (opt) => {
  if (!opt?.value) {
    baselineRun.value = null;
    return;
  }
  loadingBaseline.value = true;
  try {
    baselineRun.value = await $fetch<TestRunDetails>(`/api/test-runs/${opt.value}`);
  } catch {
    // ignore
  } finally {
    loadingBaseline.value = false;
  }
});

function compareWithPrevious() {
  if (previousRunId.value) {
    const match = projectRunOptions.value.find((o) => o.value === previousRunId.value);
    if (match) compareRunA.value = match;
  }
}

const currentRunRef = computed<TestRunDetails | null>(() => testRun.value);
const { comparisonData, comparisonSummary } = useRunComparison(baselineRun, currentRunRef);

const comparisonColumns: TableColumn<ComparisonRow>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<ComparisonRow>('Test case'),
    cell: ({ row }) => h('span', { class: 'font-medium' }, row.getValue('title')),
  },
  {
    accessorKey: 'statusA',
    header: createSortHeader<ComparisonRow>('Status A'),
    cell: ({ row }) => {
      const status = row.getValue('statusA') as string | null;
      if (!status) return h('span', { class: 'text-gray-400' }, '—');
      const color = getStatusColor(status);
      return h(resolveComponent('UBadge'), { color, class: 'capitalize' }, () => status);
    },
  },
  {
    accessorKey: 'statusB',
    header: createSortHeader<ComparisonRow>('Status B'),
    cell: ({ row }) => {
      const status = row.getValue('statusB') as string | null;
      if (!status) return h('span', { class: 'text-gray-400' }, '—');
      const color = getStatusColor(status);
      return h(resolveComponent('UBadge'), { color, class: 'capitalize' }, () => status);
    },
  },
  {
    accessorKey: 'durationA',
    header: createSortHeader<ComparisonRow>('Duration A'),
    cell: ({ row }) => {
      const val = row.getValue('durationA') as number | null;
      return val !== null ? formatDuration(val) : h('span', { class: 'text-gray-400' }, '—');
    },
  },
  {
    accessorKey: 'durationB',
    header: createSortHeader<ComparisonRow>('Duration B'),
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
</script>

<template>
  <div>
    <template v-if="testRun && !isLive">
      <div class="space-y-4">
        <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run A (baseline)</label>
            <USelectMenu v-model="compareRunA" :items="projectRunOptions" placeholder="Select a baseline run..." />
          </div>
          <div>
            <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run B (this run)</label>
            <div class="flex items-center gap-2 py-1.5">
              <RunStatusBadge :status="testRun.status" />
              <span class="font-medium">#{{ testRun.id }}</span>
            </div>
          </div>
        </div>

        <div v-if="previousRunId" class="flex">
          <UButton
            icon="i-lucide-arrow-left-right"
            size="sm"
            variant="outline"
            label="Compare with previous run"
            @click="compareWithPrevious"
          />
        </div>

        <div v-if="loadingBaseline" class="flex items-center justify-center py-6 text-gray-500 gap-2">
          <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
          <span>Loading baseline data...</span>
        </div>

        <template v-else-if="baselineRun && comparisonData.length > 0">
          <div class="flex flex-wrap gap-4 text-sm">
            <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">Status</span>
            <UBadge v-if="comparisonSummary.newFailures > 0" color="error" variant="soft" size="lg">
              {{ comparisonSummary.newFailures }} new failure{{ comparisonSummary.newFailures > 1 ? 's' : '' }}
            </UBadge>
            <UBadge v-if="comparisonSummary.recovered > 0" color="success" variant="soft" size="lg">
              {{ comparisonSummary.recovered }} recovered
            </UBadge>
            <UBadge v-if="comparisonSummary.stillFailing > 0" color="warning" variant="soft" size="lg">
              {{ comparisonSummary.stillFailing }} still failing
            </UBadge>
            <span
              v-if="
                comparisonSummary.newFailures === 0 &&
                comparisonSummary.recovered === 0 &&
                comparisonSummary.stillFailing === 0
              "
              class="text-sm text-gray-500"
              >No status changes</span
            >
          </div>
          <div class="flex flex-wrap gap-4 text-sm">
            <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">Duration changes</span>
            <UBadge v-if="comparisonSummary.regressed > 0" color="error" variant="soft" size="lg">
              {{ comparisonSummary.regressed }} regressed
            </UBadge>
            <UBadge v-if="comparisonSummary.improved > 0" color="success" variant="soft" size="lg">
              {{ comparisonSummary.improved }} improved
            </UBadge>
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
        </template>

        <div v-else-if="compareRunA && !loadingBaseline" class="text-center py-8 text-gray-500">
          <UIcon name="i-lucide-git-compare-arrows" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
          <p>No comparison data available.</p>
        </div>

        <div v-else class="text-center py-8 text-gray-500">
          <UIcon name="i-lucide-arrow-left-right" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
          <p>Select a baseline run to compare.</p>
        </div>
      </div>
    </template>
    <div v-else-if="isLive" class="text-center py-10 text-gray-500">
      <UIcon name="i-lucide-git-compare-arrows" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
      <p>Comparison is available after the run finishes.</p>
    </div>
  </div>
</template>
