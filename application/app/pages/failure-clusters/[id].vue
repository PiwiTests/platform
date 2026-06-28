<script setup lang="ts">
import type { FailureClusterDetail } from '~~/types/api';
import { renderAnsi } from '~/utils';

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

// Breadcrumbs
const breadcrumbItems = computed(() => [
  { label: 'Home', icon: 'i-lucide-house', to: '/' },
  { label: 'Projects', to: '/projects' },
  ...(cluster.value?.project
    ? [
        {
          label: cluster.value.project.label || cluster.value.project.name || 'Project',
          to: `/projects/${cluster.value.project.id}?tab=failure-clusters`,
        },
      ]
    : [{ label: 'Project' }]),
  { label: `Failure cluster #${clusterId}` },
]);
</script>

<template>
  <UDashboardPanel id="failure-cluster-detail">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb :items="breadcrumbItems" />
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
    </template>

    <template #body>
      <div v-if="cluster" class="flex flex-col min-h-0">
        <!-- Summary -->
        <div class="border-b border-default shrink-0">
          <ClusterSummary
            :cluster="cluster"
            :triage-status="triageStatus"
            :triage-note="triageNote"
            :triage-saving="triageSaving"
            :triage-changed="triageChanged"
            @update:triage-status="triageStatus = $event"
            @update:triage-note="triageNote = $event"
            @save-triage="saveTriage"
            @extract="extractModalOpen = true"
          />
        </div>

        <!-- Body: two columns — left is wider (investigation heavy) -->
        <div class="flex-1 min-h-0 grid grid-cols-1 xl:grid-cols-[3fr_2fr] gap-4 p-1 overflow-hidden">
          <!-- Left: error + test evidence + SCM investigation -->
          <div class="space-y-4 overflow-y-auto">
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

            <!-- Locator healing: alternative suggestions for the failing locator -->
            <LocatorHealingPanel
              v-if="cluster.affectedTestCases?.length && cluster.affectedTestCases[0]?.recentTestRunsCaseId"
              :run-id="cluster.lastSeenRunId"
              :test-runs-case-id="cluster.affectedTestCases[0].recentTestRunsCaseId"
            />

            <!-- Test evidence: source, screenshots, traces, steps, aria, signals -->
            <SectionCard
              v-if="cluster.affectedTestCases?.length"
              icon="i-lucide-flask-conical"
              title="Test evidence"
              help="cluster.evidence"
            >
              <template #actions>
                <UBadge color="neutral" variant="subtle" size="sm">
                  {{ cluster.affectedTestCases.length }}
                  {{ cluster.affectedTestCases.length === 1 ? 'test' : 'tests' }}
                </UBadge>
              </template>
              <ClusterTestEvidence
                :affected-test-cases="cluster.affectedTestCases"
                :sample-error="cluster.sampleError"
              />
            </SectionCard>

            <!-- SCM investigation: baseline picker + commit diff -->
            <SectionCard icon="i-lucide-git-compare-arrows" title="What changed" help="cluster.scm">
              <ClusterInvestigation />
            </SectionCard>
          </div>

          <!-- Right: diagnosis -->
          <div class="overflow-y-auto">
            <DiagnosisPanel
              :cluster-id="clusterId"
              :last-seen-run-id="cluster?.lastSeenRunId"
              :affected-test-cases="cluster?.affectedTestCases ?? []"
            />
          </div>
        </div>
      </div>

      <div v-else class="flex items-center justify-center h-64 text-gray-500">Cluster not found.</div>
    </template>
  </UDashboardPanel>

  <ClusterExtractCasesModal
    v-if="cluster"
    :open="extractModalOpen"
    :cluster-id="clusterId"
    :affected-test-cases="cluster.affectedTestCases ?? []"
    @update:open="extractModalOpen = $event"
    @extracted="onExtracted"
  />
</template>
