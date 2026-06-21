<script setup lang="ts">
import type { FailureClusterDetail } from '~~/types/api';
import { formatRelativeTime, renderAnsi } from '~/utils';

const route = useRoute();
const clusterId = parseInt(String(route.params.id));

// Provide shared diagnosis/investigation state (consumed by ClusterInvestigation
// and ClusterDiagnosis). Must run before the top-level await below so provide()
// and lifecycle hooks register against the active setup instance.
provideClusterDiagnosis(clusterId);

const { data: cluster, refresh } = await useFetch<FailureClusterDetail>(`/api/failure-clusters/${clusterId}`);

useHead(computed(() => ({ title: `${cluster.value?.signature ?? 'Failure cluster'} — Piwi Dashboard` })));

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

// Extract cases modal
const extractModalOpen = ref(false);

function onExtracted() {
  extractModalOpen.value = false;
  refresh();
}

const triageStatusOptions = [
  { label: 'Open', value: 'open', color: 'warning' as const },
  { label: 'Resolved', value: 'resolved', color: 'success' as const },
  { label: 'Ignored', value: 'ignored', color: 'neutral' as const },
];

const { copyRich, copied: clusterCopied } = useCopyRich();

function copyCluster() {
  const c = cluster.value;
  if (!c) return;
  const url = window.location.href;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // eslint-disable-next-line no-control-regex
  const stripAnsi = (s: string) => s.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');

  const meta = [
    c.errorType,
    `${c.occurrences} occurrence${c.occurrences === 1 ? '' : 's'}`,
    `${c.affectedTests} test${c.affectedTests === 1 ? '' : 's'} affected`,
    c.status !== 'open' ? c.status : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const aiSummary =
    c.diagnosis?.status === 'completed' && c.diagnosis.summary
      ? `AI diagnosis (${c.diagnosis.category ?? 'unknown'}, ${c.diagnosis.confidence ?? '?'} confidence): ${c.diagnosis.summary}`
      : null;

  const plain = [
    `❌ Failure cluster: ${c.signature}`,
    meta,
    '',
    ...(c.sampleError ? ['Sample error:', stripAnsi(c.sampleError), ''] : []),
    ...(aiSummary ? [aiSummary, ''] : []),
    `Cluster: ${url}`,
  ].join('\n');

  const html = [
    `<p><strong>❌ Failure cluster</strong>: <code>${esc(c.signature)}</code></p>`,
    `<p><em>${esc(meta)}</em></p>`,
    c.sampleError ? `<p><strong>Sample error:</strong></p><pre>${renderAnsi(c.sampleError)}</pre>` : '',
    aiSummary
      ? `<p><strong>AI diagnosis</strong> (${esc(c.diagnosis?.category ?? 'unknown')}, ${esc(c.diagnosis?.confidence ?? '?')} confidence):<br>${esc(c.diagnosis!.summary!)}</p>`
      : '',
    `<p>🔗 <a href="${url}">View failure cluster</a></p>`,
  ].join('');

  copyRich(plain, html, { toast: 'Failure cluster copied' });
}
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
      <template #right>
        <UTooltip v-if="cluster" :text="clusterCopied ? 'Copied!' : 'Copy failure cluster'">
          <UButton
            size="sm"
            variant="ghost"
            color="neutral"
            :icon="clusterCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
            @click="copyCluster"
          />
        </UTooltip>
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
              <UBadge v-if="cluster.errorType" :color="clusterErrorTypeColor(cluster.errorType)" variant="subtle">
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
          <div class="shrink-0 sm:w-[26rem] space-y-3">
            <div class="space-y-1.5">
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
                  <UTextarea v-model="triageNote" placeholder="Optional note…" :rows="3" class="text-sm w-full" />
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
            <UButton
              v-if="cluster.affectedTestCases?.length"
              block
              size="xs"
              color="warning"
              variant="outline"
              icon="i-lucide-arrow-up-from-line"
              title="Unlink incorrectly clustered test cases from this group"
              @click="extractModalOpen = true"
            >
              Extract
            </UButton>
          </div>
        </div>
      </div>

      <!-- Body: two columns — left is wider (investigation heavy) -->
      <div class="px-6 py-5 grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-6 items-start">
        <!-- Left: error + test evidence + SCM investigation -->
        <div class="space-y-4">
          <!-- Error message -->
          <SectionCard
            v-if="cluster.sampleError"
            icon="i-lucide-circle-x"
            icon-class="text-red-500"
            title="Error message"
          >
            <!-- eslint-disable-next-line vue/no-v-html -->
            <div
              class="text-xs font-mono overflow-x-auto whitespace-pre-wrap"
              v-html="renderAnsi(cluster.sampleError)"
            />
          </SectionCard>

          <!-- Test evidence: source, screenshots, traces, steps, aria, signals -->
          <SectionCard v-if="cluster.affectedTestCases?.length" icon="i-lucide-flask-conical" title="Test evidence">
            <template #actions>
              <UBadge color="neutral" variant="subtle" size="sm">
                {{ cluster.affectedTestCases.length }}
                {{ cluster.affectedTestCases.length === 1 ? 'test' : 'tests' }}
              </UBadge>
            </template>
            <ClusterTestEvidence :affected-test-cases="cluster.affectedTestCases" :sample-error="cluster.sampleError" />
          </SectionCard>

          <!-- SCM investigation: baseline picker + commit diff -->
          <SectionCard icon="i-lucide-git-compare-arrows" title="What changed">
            <ClusterInvestigation />
          </SectionCard>
        </div>

        <!-- Right: diagnosis -->
        <div>
          <DiagnosisPanel :cluster-id="clusterId" />
        </div>
      </div>
    </div>

    <div v-else class="flex items-center justify-center h-64 text-gray-500">Cluster not found.</div>

    <ClusterExtractCasesModal
      v-if="cluster"
      :open="extractModalOpen"
      :cluster-id="clusterId"
      :affected-test-cases="cluster.affectedTestCases ?? []"
      @update:open="extractModalOpen = $event"
      @extracted="onExtracted"
    />
  </UDashboardPanel>
</template>
