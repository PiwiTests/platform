<script setup lang="ts">
const props = defineProps<{
  testRunId: number;
  runStatus: string;
}>();

interface RunInsightsData {
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
  flakyOnRetry: Array<{ testRunsCaseId: number; title: string; filePath: string; retries: number }>;
  clusterNew: Array<{ clusterId: number; signature: string }>;
}

const data = ref<RunInsightsData | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

async function load() {
  if (
    !props.testRunId ||
    props.runStatus === 'running' ||
    props.runStatus === 'initialising' ||
    props.runStatus === 'finalizing'
  ) {
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

const totalRegressions = computed(
  () => (data.value?.newRegressions.length ?? 0) + (data.value?.recurrences.length ?? 0),
);
const totalFixed = computed(() => (data.value?.recovered.length ?? 0) + (data.value?.newFlaky.length ?? 0));

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

  <div v-else-if="!data" class="p-4">
    <EmptyState text="All clear" />
  </div>

  <div v-else class="space-y-6 p-4">
    <div class="flex items-center gap-1.5 text-sm text-muted">
      <UIcon name="i-lucide-sparkles" class="size-4 shrink-0 text-primary/70" />
      <span>Automatic highlights from this run</span>
      <HelpHint topic="run.insights" />
    </div>

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
