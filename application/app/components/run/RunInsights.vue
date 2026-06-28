<script setup lang="ts">
const props = defineProps<{
  testRunId: number;
  runStatus: string;
  /** Increments when the run finishes so this tab can refetch. */
  refreshKey?: number;
}>();

interface RunInsightsData {
  hasBaseline: boolean;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  passRate: number;
  baselinePassRate: number;
  passRateDelta: number;
  avgDurationDelta: number | null;
  newRegressions: Array<{ testRunsCaseId: number; title: string; filePath: string; duration: number | null }>;
  recurrences: Array<{ testRunsCaseId: number; title: string; filePath: string; duration: number | null }>;
  recovered: Array<{ testRunsCaseId: number; title: string; filePath: string; duration: number | null }>;
  newFlaky: Array<{ testRunsCaseId: number; title: string; filePath: string; duration: number | null }>;
  slowestTests: Array<{ testRunsCaseId: number; title: string; filePath: string; duration: number }>;
  mostImproved: Array<{
    testRunsCaseId: number;
    title: string;
    filePath: string;
    durationBefore: number;
    durationAfter: number;
    pctChange: number;
  }>;
  mostRegressed: Array<{
    testRunsCaseId: number;
    title: string;
    filePath: string;
    durationBefore: number;
    durationAfter: number;
    pctChange: number;
  }>;
  workerImbalance: Array<{ workerIndex: number; count: number }>;
  workerImbalanceWarning: string | null;
  flakyOnRetry: Array<{ testRunsCaseId: number; title: string; filePath: string; retries: number }>;
  clusterNew: Array<{ clusterId: number; signature: string }>;
}

const passRateDeltaColor = computed(() => {
  if (!data.value) return '';
  const delta = data.value.passRateDelta;
  if (delta > 0) return 'text-green-600';
  if (delta < 0) return 'text-red-600';
  return 'text-muted';
});

const passRateDeltaArrow = computed(() => {
  if (!data.value) return '';
  const delta = data.value.passRateDelta;
  if (delta > 0) return 'i-lucide-trending-up';
  if (delta < 0) return 'i-lucide-trending-down';
  return 'i-lucide-minus';
});

const avgDurationColorClass = computed(() => {
  if (data.value?.avgDurationDelta == null) return '';
  return data.value.avgDurationDelta > 0 ? 'text-red-600' : 'text-green-600';
});

const data = ref<RunInsightsData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

const isRunActive = computed(
  () => props.runStatus === 'running' || props.runStatus === 'initialising' || props.runStatus === 'finalizing',
);

async function load() {
  if (!props.testRunId || isRunActive.value) {
    data.value = null;
    return;
  }
  loading.value = true;
  error.value = null;
  try {
    data.value = await $fetch<RunInsightsData>(`/api/test-runs/${props.testRunId}/insights`);
  } catch (e: any) {
    error.value = e?.data?.message || e?.message || 'Failed to load insights';
  } finally {
    loading.value = false;
  }
}

watch(() => props.testRunId, load, { immediate: true });

// Refetch when the run finishes (load() early-returns while the run is active,
// so without this the tab stays empty until a remount).
watch(
  () => props.refreshKey,
  (key, oldKey) => {
    if (key !== oldKey && key !== undefined) load();
  },
);

const hasAnyInsights = computed(() => {
  if (!data.value) return false;
  const d = data.value;
  return (
    d.newRegressions.length > 0 ||
    d.recurrences.length > 0 ||
    d.recovered.length > 0 ||
    d.newFlaky.length > 0 ||
    d.flakyOnRetry.length > 0 ||
    d.mostRegressed.length > 0 ||
    d.mostImproved.length > 0 ||
    d.slowestTests.length > 0 ||
    d.workerImbalance.length > 1 ||
    d.clusterNew.length > 0
  );
});

function formatMs(ms: number | null | undefined): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}
</script>

<template>
  <ErrorState v-if="error" :text="error" padded>
    <template #action>
      <UButton size="sm" @click="load">Retry</UButton>
    </template>
  </ErrorState>

  <LoadingState v-else-if="loading" padded />

  <div v-else-if="isRunActive" class="p-4">
    <EmptyState icon="i-lucide-loader-circle" text="Run in progress">
      <p class="text-sm text-muted max-w-sm text-center">
        Insights are computed once the run finishes. Switch back here when the run completes.
      </p>
    </EmptyState>
  </div>

  <div v-else-if="!data" class="p-4">
    <EmptyState text="No insights yet" />
  </div>

  <div v-else-if="!data.hasBaseline" class="p-4">
    <EmptyState icon="i-lucide-git-compare-arrows" text="No baseline run found">
      <p class="text-sm text-muted max-w-sm text-center">
        Insights compare this run against the most recent passing run in the same project. No previous passing run
        exists yet — once you have at least two completed runs, comparisons will appear here automatically.
      </p>
    </EmptyState>
  </div>

  <div v-else class="space-y-6 p-4">
    <div class="flex items-center gap-1.5 text-sm text-muted">
      <UIcon name="i-lucide-sparkles" class="size-4 shrink-0 text-primary/70" />
      <span>Automatic highlights from this run</span>
      <HelpHint topic="run.insights" />
    </div>

    <!-- Summary card -->
    <SectionCard icon="i-lucide-bar-chart-3" icon-class="text-blue-500" title="Run summary">
      <div class="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div class="space-y-1">
          <p class="text-xs text-muted">Pass rate</p>
          <p class="text-xl font-semibold">{{ data.passRate }}%</p>
          <div class="flex items-center gap-1 text-xs" :class="passRateDeltaColor">
            <UIcon :name="passRateDeltaArrow" class="size-3.5" />
            <span v-if="data.passRateDelta !== 0"
              >{{ data.passRateDelta > 0 ? '+' : '' }}{{ data.passRateDelta }}pp vs baseline</span
            >
            <span v-else>Same as baseline</span>
          </div>
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted">Avg duration</p>
          <p v-if="data.avgDurationDelta !== null" class="text-xl font-semibold" :class="avgDurationColorClass">
            {{ data.avgDurationDelta > 0 ? '+' : '' }}{{ data.avgDurationDelta }}%
          </p>
          <p v-else class="text-xl font-semibold text-muted">—</p>
          <p class="text-xs text-muted">vs baseline (passing tests)</p>
        </div>
        <div class="space-y-1">
          <p class="text-xs text-muted">Changes</p>
          <div class="space-y-0.5 text-sm">
            <p v-if="data.newRegressions.length > 0" class="text-red-500">
              +{{ data.newRegressions.length }} regressed
            </p>
            <p v-if="data.recovered.length > 0" class="text-green-600">+{{ data.recovered.length }} fixed</p>
            <p v-if="data.newFlaky.length > 0" class="text-purple-500">+{{ data.newFlaky.length }} flaky</p>
            <p v-if="!data.newRegressions.length && !data.recovered.length && !data.newFlaky.length" class="text-muted">
              No status changes
            </p>
          </div>
        </div>
      </div>
    </SectionCard>

    <!-- New regressions -->
    <SectionCard
      v-if="data.newRegressions.length > 0"
      icon="i-lucide-alert-circle"
      icon-class="text-red-500"
      title="New regressions"
      :count="data.newRegressions.length"
    >
      <div class="space-y-1">
        <NuxtLink
          v-for="nr in data.newRegressions"
          :key="nr.testRunsCaseId"
          :to="`/test-run-cases/${nr.testRunsCaseId}`"
          class="flex items-center gap-2 text-sm hover:bg-red-50 dark:hover:bg-red-900/10 rounded px-1 -mx-1 transition-colors"
        >
          <UBadge color="error" variant="solid" size="xs">NEW</UBadge>
          <span class="font-medium text-primary hover:underline truncate">{{ nr.title }}</span>
          <span class="text-gray-400 text-xs ml-auto shrink-0">{{ formatMs(nr.duration) }}</span>
        </NuxtLink>
      </div>
    </SectionCard>

    <!-- Recurring failures -->
    <SectionCard
      v-if="data.recurrences.length > 0"
      icon="i-lucide-refresh-cw"
      icon-class="text-amber-500"
      title="Recurring failures"
      :count="data.recurrences.length"
    >
      <div class="space-y-1">
        <NuxtLink
          v-for="r in data.recurrences"
          :key="r.testRunsCaseId"
          :to="`/test-run-cases/${r.testRunsCaseId}`"
          class="flex items-center gap-2 text-sm hover:bg-amber-50 dark:hover:bg-amber-900/10 rounded px-1 -mx-1 transition-colors"
        >
          <UBadge color="warning" variant="solid" size="xs">RECURRING</UBadge>
          <span class="font-medium text-primary hover:underline truncate">{{ r.title }}</span>
        </NuxtLink>
      </div>
    </SectionCard>

    <!-- Fixed tests -->
    <SectionCard
      v-if="data.recovered.length > 0"
      icon="i-lucide-check-circle"
      icon-class="text-green-500"
      title="Fixed tests"
      :count="data.recovered.length"
    >
      <div class="space-y-1">
        <NuxtLink
          v-for="r in data.recovered"
          :key="r.testRunsCaseId"
          :to="`/test-run-cases/${r.testRunsCaseId}`"
          class="flex items-center gap-2 text-sm hover:bg-green-50 dark:hover:bg-green-900/10 rounded px-1 -mx-1 transition-colors"
        >
          <UBadge color="success" variant="solid" size="xs">FIXED</UBadge>
          <span class="font-medium text-primary hover:underline truncate">{{ r.title }}</span>
        </NuxtLink>
      </div>
    </SectionCard>

    <!-- New flaky -->
    <SectionCard
      v-if="data.newFlaky.length > 0"
      icon="i-lucide-flask"
      icon-class="text-purple-500"
      title="New flaky tests"
      :count="data.newFlaky.length"
    >
      <div class="space-y-1">
        <NuxtLink
          v-for="f in data.newFlaky"
          :key="f.testRunsCaseId"
          :to="`/test-run-cases/${f.testRunsCaseId}`"
          class="flex items-center gap-2 text-sm hover:bg-purple-50 dark:hover:bg-purple-900/10 rounded px-1 -mx-1 transition-colors"
        >
          <UBadge color="info" variant="solid" size="xs">FLAKY</UBadge>
          <span class="font-medium text-primary hover:underline truncate">{{ f.title }}</span>
          <span class="text-gray-400 text-xs ml-auto shrink-0">{{ formatMs(f.duration) }}</span>
        </NuxtLink>
      </div>
    </SectionCard>

    <!-- Passed on retry (flaky) -->
    <SectionCard
      v-if="data.flakyOnRetry.length > 0"
      icon="i-lucide-repeat"
      icon-class="text-orange-500"
      title="Passed on retry"
      :count="data.flakyOnRetry.length"
      subtitle="Tests that passed but needed one or more retries"
    >
      <div class="space-y-1">
        <NuxtLink
          v-for="f in data.flakyOnRetry"
          :key="f.testRunsCaseId"
          :to="`/test-run-cases/${f.testRunsCaseId}`"
          class="flex items-center gap-2 text-sm hover:bg-orange-50 dark:hover:bg-orange-900/10 rounded px-1 -mx-1 transition-colors"
        >
          <UBadge color="warning" variant="subtle" size="xs">×{{ f.retries }}</UBadge>
          <span class="font-medium text-primary hover:underline truncate">{{ f.title }}</span>
        </NuxtLink>
      </div>
    </SectionCard>

    <!-- Performance changes -->
    <SectionCard
      v-if="data.mostRegressed.length > 0 || data.mostImproved.length > 0"
      icon="i-lucide-trending-up"
      icon-class="text-blue-500"
      title="Performance changes"
    >
      <div class="grid grid-cols-2 gap-4">
        <div v-if="data.mostRegressed.length > 0">
          <p class="text-xs font-medium text-red-500 mb-2">Most regressed</p>
          <div class="space-y-1">
            <NuxtLink
              v-for="r in data.mostRegressed"
              :key="r.testRunsCaseId"
              :to="`/test-run-cases/${r.testRunsCaseId}`"
              class="flex items-center gap-2 text-sm hover:bg-red-50 dark:hover:bg-red-900/10 rounded px-1 -mx-1 transition-colors"
            >
              <span class="text-red-500 font-mono shrink-0">+{{ r.pctChange }}%</span>
              <span class="truncate text-primary hover:underline">{{ r.title }}</span>
            </NuxtLink>
          </div>
        </div>
        <div v-if="data.mostImproved.length > 0">
          <p class="text-xs font-medium text-green-500 mb-2">Most improved</p>
          <div class="space-y-1">
            <NuxtLink
              v-for="i in data.mostImproved"
              :key="i.testRunsCaseId"
              :to="`/test-run-cases/${i.testRunsCaseId}`"
              class="flex items-center gap-2 text-sm hover:bg-green-50 dark:hover:bg-green-900/10 rounded px-1 -mx-1 transition-colors"
            >
              <span class="text-green-500 font-mono shrink-0">{{ i.pctChange }}%</span>
              <span class="truncate text-primary hover:underline">{{ i.title }}</span>
            </NuxtLink>
          </div>
        </div>
      </div>
    </SectionCard>

    <!-- Slowest tests -->
    <SectionCard
      v-if="data.slowestTests.length > 0"
      icon="i-lucide-clock"
      icon-class="text-amber-500"
      title="Slowest tests"
    >
      <div class="space-y-1">
        <NuxtLink
          v-for="st in data.slowestTests"
          :key="st.testRunsCaseId"
          :to="`/test-run-cases/${st.testRunsCaseId}`"
          class="flex items-center gap-2 text-sm hover:bg-amber-50 dark:hover:bg-amber-900/10 rounded px-1 -mx-1 transition-colors"
        >
          <div class="flex-1 truncate text-primary hover:underline">{{ st.title }}</div>
          <div class="text-gray-500 font-mono text-xs shrink-0">{{ formatMs(st.duration) }}</div>
          <div class="w-24 h-2 rounded-full bg-gray-100 shrink-0">
            <div
              class="h-full rounded-full bg-amber-400"
              :style="{ width: Math.min(100, (st.duration / (data.slowestTests[0]?.duration || 1)) * 100) + '%' }"
            />
          </div>
        </NuxtLink>
      </div>
    </SectionCard>

    <!-- Worker imbalance -->
    <SectionCard
      v-if="data.workerImbalance.length > 1"
      icon="i-lucide-users"
      icon-class="text-gray-500"
      title="Worker distribution"
    >
      <div v-if="data.workerImbalanceWarning" class="flex items-center gap-1.5 text-xs text-amber-600 mb-3">
        <UIcon name="i-lucide-alert-triangle" class="size-3.5 shrink-0" />
        <span>{{ data.workerImbalanceWarning }}</span>
      </div>
      <div class="flex items-end gap-2 h-20">
        <div v-for="w in data.workerImbalance" :key="w.workerIndex" class="flex-1 flex flex-col items-center gap-1">
          <span class="text-xs text-gray-500">{{ w.count }}</span>
          <div
            class="w-full bg-blue-400 rounded-t"
            :style="{
              height: Math.max(4, (w.count / Math.max(...data.workerImbalance.map((x) => x.count))) * 60) + 'px',
            }"
          />
          <span class="text-xs text-gray-400">W{{ w.workerIndex }}</span>
        </div>
      </div>
    </SectionCard>

    <!-- New clusters -->
    <SectionCard
      v-if="data.clusterNew.length > 0"
      icon="i-lucide-layers"
      icon-class="text-purple-500"
      title="New failure clusters"
      :count="data.clusterNew.length"
    >
      <div class="space-y-1">
        <NuxtLink
          v-for="c in data.clusterNew"
          :key="c.clusterId"
          :to="`/failure-clusters/${c.clusterId}`"
          class="flex items-center gap-2 text-sm text-primary hover:underline"
        >
          <span class="truncate">{{ c.signature }}</span>
        </NuxtLink>
      </div>
    </SectionCard>
  </div>
</template>
