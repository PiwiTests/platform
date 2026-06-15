<script setup lang="ts">
import type { FailureClusterDetail } from '~~/types/api';
import { formatRelativeTime, renderAnsi } from '~/utils';

const route = useRoute();
const clusterId = parseInt(String(route.params.id));

const { data: cluster, refresh } = await useFetch<FailureClusterDetail>(`/api/failure-clusters/${clusterId}`);

useHead(computed(() => ({ title: `${cluster.value?.signature ?? 'Failure cluster'} — Piwi Dashboard` })));

const errorTypeColors: Record<string, 'error' | 'warning' | 'info' | 'neutral' | 'secondary'> = {
  timeout: 'warning',
  assertion: 'error',
  'strict-mode': 'info',
  navigation: 'secondary',
  crash: 'error',
  unknown: 'neutral',
};

// Triage
const triageStatus = ref(cluster.value?.status ?? 'open');
const triageNote = ref(cluster.value?.triageNote ?? '');
const triageSaving = ref(false);

watch(
  () => cluster.value?.status,
  (v) => {
    if (v) triageStatus.value = v;
  },
);
watch(
  () => cluster.value?.triageNote,
  (v) => {
    triageNote.value = v ?? '';
  },
);

const triageChanged = computed(
  () =>
    triageStatus.value !== (cluster.value?.status ?? 'open') ||
    triageNote.value.trim() !== (cluster.value?.triageNote ?? ''),
);

async function saveTriage() {
  triageSaving.value = true;
  try {
    await $fetch(`/api/failure-clusters/${clusterId}/status`, {
      method: 'PATCH',
      body: { status: triageStatus.value, triageNote: triageNote.value.trim() || null },
    });
    refresh();
  } finally {
    triageSaving.value = false;
  }
}

const triageStatusOptions = [
  { label: 'Open', value: 'open', color: 'warning' as const },
  { label: 'Resolved', value: 'resolved', color: 'success' as const },
  { label: 'Ignored', value: 'ignored', color: 'neutral' as const },
];

// Shared investigation state — set by ClusterInvestigation, read by ClusterDiagnosis
const baseCommit = ref('');
const selectedCommitShas = ref<string[]>([]);
</script>

<template>
  <UDashboardPanel>
    <UDashboardNavbar title="Failure cluster">
      <template #leading>
        <UButton
          v-if="cluster?.project"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          :to="`/projects/${cluster.project.id}?tab=failure-clusters`"
        >
          {{ cluster.project.label || cluster.project.name }}
        </UButton>
      </template>
    </UDashboardNavbar>

    <div v-if="cluster" class="h-full overflow-y-auto flex flex-col">
      <!-- Summary: two-column -->
      <div class="px-6 pt-5 pb-4 border-b border-default shrink-0">
        <div class="flex flex-col sm:flex-row sm:items-start gap-4 sm:gap-8">
          <!-- Left: cluster metadata -->
          <div class="flex-1 min-w-0 space-y-2.5">
            <p class="font-mono text-sm break-all text-gray-800 dark:text-gray-200">
              {{ cluster.signature }}
            </p>
            <div class="flex flex-wrap gap-2">
              <UBadge
                v-if="cluster.errorType"
                :color="errorTypeColors[cluster.errorType] || 'neutral'"
                variant="subtle"
              >
                {{ cluster.errorType }}
              </UBadge>
              <UBadge color="neutral" variant="subtle">
                {{ cluster.occurrences }} occurrence{{ cluster.occurrences === 1 ? '' : 's' }}
              </UBadge>
              <UBadge color="neutral" variant="subtle">
                {{ cluster.affectedTests }} {{ cluster.affectedTests === 1 ? 'test' : 'tests' }} affected
              </UBadge>
              <UBadge
                v-if="cluster.diagnosis?.status === 'completed' && cluster.diagnosis?.category"
                color="neutral"
                variant="outline"
                class="gap-1"
              >
                <UIcon name="i-lucide-sparkles" class="size-3" />
                {{ cluster.diagnosis.category }}
              </UBadge>
            </div>
            <p class="text-sm text-gray-500">
              First seen in
              <NuxtLink :to="`/test-runs/${cluster.firstSeenRunId}`" class="text-primary hover:underline">
                run #{{ cluster.firstSeenRunId }}
              </NuxtLink>
              · Last seen in
              <NuxtLink :to="`/test-runs/${cluster.lastSeenRunId}`" class="text-primary hover:underline">
                run #{{ cluster.lastSeenRunId }}
              </NuxtLink>
              <template v-if="cluster.lastSeenAt"> ({{ formatRelativeTime(cluster.lastSeenAt) }}) </template>
            </p>
          </div>

          <!-- Right: triage -->
          <div class="shrink-0 sm:w-[26rem] space-y-1.5">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wide">Triage</p>
            <div class="flex items-start gap-3">
              <div class="flex flex-col gap-1 shrink-0">
                <UButton
                  v-for="opt in triageStatusOptions"
                  :key="opt.value"
                  size="xs"
                  class="justify-start"
                  :color="triageStatus === opt.value ? opt.color : 'neutral'"
                  :variant="triageStatus === opt.value ? 'solid' : 'outline'"
                  @click="triageStatus = opt.value"
                >
                  {{ opt.label }}
                </UButton>
              </div>
              <div class="flex-1 min-w-0 space-y-1.5">
                <UTextarea v-model="triageNote" placeholder="Optional note…" :rows="4" class="text-sm w-full" />
                <div class="flex justify-end">
                  <UButton
                    v-if="triageChanged"
                    size="xs"
                    icon="i-lucide-check"
                    :loading="triageSaving"
                    @click="saveTriage"
                  >
                    Save
                  </UButton>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- Body: two columns — left is wider (investigation heavy) -->
      <div class="px-6 py-5 grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-6 items-start">
        <!-- Left: error + test evidence + SCM investigation -->
        <div class="space-y-4">
          <!-- Error message -->
          <UCard v-if="cluster.sampleError">
            <template #header>
              <div class="flex items-center gap-1.5">
                <UIcon name="i-lucide-circle-x" class="size-4 text-red-500 shrink-0" />
                <h3 class="font-semibold">Error message</h3>
              </div>
            </template>
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
              class="text-xs font-mono overflow-x-auto whitespace-pre-wrap"
              v-html="renderAnsi(cluster.sampleError)"
            />
          </UCard>

          <!-- Test evidence: source, screenshots, traces, steps, aria, signals -->
          <UCard v-if="cluster.affectedTestCases?.length">
            <template #header>
              <div class="flex items-center gap-1.5">
                <UIcon name="i-lucide-flask-conical" class="size-4 text-primary shrink-0" />
                <h3 class="font-semibold">Test evidence</h3>
                <UBadge color="neutral" variant="subtle" size="sm" class="ml-auto">
                  {{ cluster.affectedTestCases.length }}
                  {{ cluster.affectedTestCases.length === 1 ? 'test' : 'tests' }}
                </UBadge>
              </div>
            </template>
            <ClusterTestEvidence :affected-test-cases="cluster.affectedTestCases" :sample-error="cluster.sampleError" />
          </UCard>

          <!-- SCM investigation: baseline picker + commit diff -->
          <UCard>
            <template #header>
              <div class="flex items-center gap-1.5">
                <UIcon name="i-lucide-git-compare-arrows" class="size-4 text-primary shrink-0" />
                <h3 class="font-semibold">What changed</h3>
              </div>
            </template>
            <ClusterInvestigation
              :cluster-id="clusterId"
              @base-commit-change="baseCommit = $event"
              @selected-commits-change="selectedCommitShas = $event"
            />
          </UCard>
        </div>

        <!-- Right: diagnosis -->
        <div>
          <ClusterDiagnosis
            :cluster-id="clusterId"
            :base-commit="baseCommit"
            :selected-commit-shas="selectedCommitShas"
          />
        </div>
      </div>
    </div>

    <div v-else class="flex items-center justify-center h-64 text-gray-500">Cluster not found.</div>
  </UDashboardPanel>
</template>
