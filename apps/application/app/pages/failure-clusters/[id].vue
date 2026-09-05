<script setup lang="ts">
import { describeCluster, clusterSignatureLine } from '#shared/describe-cluster';
import { caseHeadline, type FailureVerdict } from '#shared/failure-verdict';
import { parsePlaywrightError } from '#shared/error-parse';
import type { FailureCluesResult } from '#shared/handlers/test-cases';
import type { FailureClusterDetail, TraceInfo } from '~~/types/api';
import type { FixPlan, FixedBeforeMatch as FixedBeforeMatchType } from '#shared/fix-plan.types';
import { fixPlanToMarkdown } from '#shared/fix-plan-markdown';
import type { FixSectionKey } from '~/components/shared/FixCard.vue';
import { renderAnsi } from '~/utils';
import { stripAnsi } from '~/utils/text-format';
import { buildRetryCommand } from '~/utils/retry-command';
import { clusterSectionLocatorKey } from '~/composables/useClusterSectionLocator';
import { EVIDENCE_SECTION_TAB } from '~/utils/evidence-sections';

const route = useRoute();
const clusterId = parseInt(String(route.params.id));
// Share links need the server; the public demo has no share-link routes.
const isDemoMode = Boolean(useRuntimeConfig().public.demoMode);

// Quarantine/triage actions on the cluster are reporter/admin only, matching the endpoint.
const { canWrite } = useAuth();

// Provide shared diagnosis/investigation state (consumed by ClusterInvestigation
// and DiagnosisPanel). Must run before the top-level await below so provide()
// and lifecycle hooks register against the active setup instance.
provideClusterDiagnosis(clusterId);

const { data: cluster, refresh: refreshCluster } = await useFetch<FailureClusterDetail>(
  `/api/failure-clusters/${clusterId}`,
);

// The fix plan — the one artifact bundling diagnosis, edits, failing tests, owner
// and the verify command. Same endpoint the `get_fix_plan` MCP tool returns.
const { data: fixPlan } = await useFetch<FixPlan>(`/api/failure-clusters/${clusterId}/fix-plan`);

const describable = computed(() => ({
  ...(cluster.value as FailureClusterDetail),
  filePath: cluster.value?.affectedTestCases?.[0]?.filePath ?? null,
}));
const clusterName = computed(() => (cluster.value ? describeCluster(describable.value) : 'Failure cluster'));
const signatureLine = computed(() => (cluster.value ? clusterSignatureLine(describable.value) : null));

useHead(computed(() => ({ title: `${clusterName.value} — Piwi Dashboard` })));

// ── Selected affected execution ─────────────────────────────────────────────
// The evidence and the clues are shown for one affected test at a time; the
// default is the most-affected case's latest execution (the representative the
// cluster handler orders first).
const affectedCases = computed(() => cluster.value?.affectedTestCases ?? []);
// The latest occurrence — the execution in the last-seen run — is the default
// the page opens on, for both the evidence and the headline.
const latestExecId = computed(
  () => cluster.value?.latestTestRunsCaseId ?? affectedCases.value[0]?.recentTestRunsCaseId ?? null,
);
const latestCaseId = computed(() => cluster.value?.latestTestCaseId ?? affectedCases.value[0]?.testCaseId);
const selectedCaseId = ref<number | undefined>(latestCaseId.value);
watch(latestCaseId, (id) => {
  if (selectedCaseId.value === undefined) selectedCaseId.value = id;
});
watch(affectedCases, (list) => {
  if (!list.some((c) => c.testCaseId === selectedCaseId.value)) selectedCaseId.value = latestCaseId.value;
});
const selectedCase = computed(
  () => affectedCases.value.find((c) => c.testCaseId === selectedCaseId.value) ?? affectedCases.value[0] ?? null,
);
// The default case opens on its latest occurrence; switching cases shows that
// case's own most-recent execution.
const selectedExecId = computed(() =>
  selectedCase.value?.testCaseId === latestCaseId.value
    ? latestExecId.value
    : (selectedCase.value?.recentTestRunsCaseId ?? null),
);
const isLatestOccurrence = computed(() => selectedExecId.value === latestExecId.value);

const { data: execution } = await useAsyncData<Record<string, unknown> | null>(
  'cluster-selected-exec',
  () =>
    selectedExecId.value
      ? $fetch<Record<string, unknown>>(`/api/test-run-cases/${selectedExecId.value}`)
      : Promise.resolve(null),
  { watch: [selectedExecId] },
);
const { data: execTraces } = await useAsyncData<TraceInfo[]>(
  'cluster-selected-traces',
  () =>
    selectedExecId.value
      ? $fetch<{ items: TraceInfo[] }>(`/api/test-run-cases/${selectedExecId.value}/traces`).then((r) => r.items)
      : Promise.resolve([]),
  { default: (): TraceInfo[] => [], watch: [selectedExecId] },
);
const { data: cluesData } = await useAsyncData<FailureCluesResult>(
  'cluster-selected-clues',
  () =>
    selectedExecId.value
      ? $fetch<FailureCluesResult>(`/api/test-run-cases/${selectedExecId.value}/clues`)
      : Promise.resolve({ clues: [], failureAt: null }),
  { default: (): FailureCluesResult => ({ clues: [], failureAt: null }), watch: [selectedExecId] },
);

const clues = computed(() => cluesData.value?.clues ?? []);
const cluesFailureAt = computed(() => cluesData.value?.failureAt ?? null);
const topClue = computed(() => clues.value[0] ?? null);
const topClueSection = computed(() => topClue.value?.citations?.[0]?.section ?? null);
const otherClues = computed(() => clues.value.slice(1));
const hasTrace = computed(() => (execTraces.value?.length ?? 0) > 0);
const selectedRunId = computed(() => (execution.value as { testRun?: { id?: number } } | null)?.testRun?.id ?? null);

// ── Headline built from the latest occurrence's own error ────────────────────
// The loaded execution is the latest occurrence; its stored error drives the
// headline. When no execution can be loaded the cluster's stored sample error is
// the fallback, and it reflects the first occurrence.
const execError = computed(() => (execution.value as { error?: string | null } | null)?.error ?? null);
const execSteps = computed(() => (execution.value as { steps?: unknown } | null)?.steps ?? null);
const clusterVerdict = computed<FailureVerdict | null>(() => {
  const c = cluster.value;
  if (!c) return null;
  const error = execError.value ?? c.sampleError;
  if (!error) return null;
  const desc = caseHeadline({ error, steps: execError.value ? execSteps.value : null });
  if (!desc) return null;
  const parsed = parsePlaywrightError(error);
  return {
    ...desc,
    kind: parsed.kind,
    locator: parsed.locator,
    isLocatorResolutionFailure: parsed.isLocatorResolutionFailure,
    why: null,
    since: {
      firstFailingRunId: c.firstSeenRunId,
      firstFailingAt: c.firstSeenAt,
      isFirstFailure: false,
      commit: null,
    },
    cluster: null,
    owner: c.owner,
  };
});
const headlineProvenance = computed(() => {
  const c = cluster.value;
  if (!c) return null;
  if (execError.value && selectedRunId.value) {
    return `${isLatestOccurrence.value ? 'latest occurrence' : 'occurrence'}, run #${selectedRunId.value}`;
  }
  return `first occurrence, run #${c.firstSeenRunId}`;
});

// The newest known-issue link, shown compactly on the facts line.
const knownIssue = computed(() => cluster.value?.links?.[0] ?? null);

// ── Show raw error disclosure ────────────────────────────────────────────────
const rawErrorEl = ref<HTMLElement | null>(null);
const rawErrorOpen = ref(false);
function revealRawError() {
  rawErrorOpen.value = true;
  nextTick(() => rawErrorEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
}

// ── Copy summary ─────────────────────────────────────────────────────────────
const { copyRich } = useCopyRich();
function copyCluster() {
  const c = cluster.value;
  if (!c) return;
  const url = window.location.href;
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  const meta = [
    c.errorType,
    `${c.occurrences} occurrence${c.occurrences === 1 ? '' : 's'}`,
    `${c.affectedTests} test${c.affectedTests === 1 ? '' : 's'} affected`,
    c.status !== 'open' ? formatTriageStatus(c.status) : null,
  ]
    .filter(Boolean)
    .join(' · ');

  const aiSummary =
    c.diagnosis?.status === 'completed' && c.diagnosis.summary
      ? `AI diagnosis (${c.diagnosis.category ?? 'unknown'}, ${c.diagnosis.confidence ?? '?'} confidence): ${c.diagnosis.summary}`
      : null;

  const plain = [
    `❌ Failure cluster: ${clusterName.value}`,
    ...(clusterName.value !== c.signature ? [`Signature: ${c.signature}`] : []),
    meta,
    '',
    ...(c.sampleError ? ['Sample error:', stripAnsi(c.sampleError), ''] : []),
    ...(aiSummary ? [aiSummary, ''] : []),
    `Cluster: ${url}`,
  ].join('\n');

  const html = [
    `<p><strong>❌ Failure cluster</strong>: ${esc(clusterName.value)}</p>`,
    clusterName.value !== c.signature ? `<p><code>${esc(c.signature)}</code></p>` : '',
    `<p><em>${esc(meta)}</em></p>`,
    c.sampleError ? `<p><strong>Sample error:</strong></p><pre>${renderAnsi(c.sampleError)}</pre>` : '',
    aiSummary
      ? `<p><strong>AI diagnosis</strong> (${esc(c.diagnosis?.category ?? 'unknown')}, ${esc(c.diagnosis?.confidence ?? '?')} confidence):<br>${esc(c.diagnosis!.summary!)}</p>`
      : '',
    `<p>🔗 <a href="${url}">View failure cluster</a></p>`,
  ].join('');

  copyRich(plain, html, { toast: 'Failure cluster copied' });
}

// ── Retry command / CI re-run (header primary action) ────────────────────────
const affectedRetryCases = computed(() =>
  (cluster.value?.affectedTestCases ?? []).map((tc) => ({
    filePath: tc.filePath,
    title: tc.title,
    line: null,
    projectName: null,
  })),
);
const retryCommand = computed(() => buildRetryCommand(affectedRetryCases.value));
const { copy: copyRetry, copied: retryCopied } = useCopy();

interface RerunInfo {
  available: boolean;
  reason: string | null;
  provider: string | null;
  enabled: boolean;
  hasToken: boolean;
  lastDispatch: { provider: string; url: string; args: string; at: number; byName: string | null } | null;
}
const { data: rerunInfo, refresh: refreshRerun } = await useFetch<RerunInfo>(
  `/api/failure-clusters/${clusterId}/rerun`,
);
const rerunToast = useToast();
const rerunning = ref(false);
async function triggerRerun() {
  rerunning.value = true;
  try {
    const res = await $fetch<{ ok: boolean; message?: string; dispatch?: { url: string } }>(
      `/api/failure-clusters/${clusterId}/rerun`,
      { method: 'POST' },
    );
    if (res.ok && res.dispatch) {
      rerunToast.add({
        title: 'CI re-run dispatched',
        description: 'The affected tests are re-running.',
        color: 'success',
      });
      await refreshRerun();
    } else {
      rerunToast.add({
        title: 'CI re-run not started',
        description: res.message ?? 'Not available.',
        color: 'warning',
      });
    }
  } catch (e: unknown) {
    const message = (e as { data?: { message?: string }; message?: string })?.data?.message ?? 'Dispatch failed.';
    rerunToast.add({ title: 'CI re-run failed', description: message, color: 'error' });
  } finally {
    rerunning.value = false;
  }
}

function refresh() {
  refreshCluster();
  refreshRerun();
}

// ── Fix card ─────────────────────────────────────────────────────────────────
// Diagnosis first, then the locator fix, the verify command and the fix plan.
// The Locator fix section applies only to a locator-resolution failure — the same
// gate the execution page uses; a count mismatch or a value assertion has none.
const hasLocatorPanel = computed(() =>
  Boolean(clusterVerdict.value?.isLocatorResolutionFailure && affectedCases.value[0]?.recentTestRunsCaseId),
);
const showVerify = computed(() => Boolean(fixPlan.value?.verify?.command));
const showReproduce = computed(() => Boolean(fixPlan.value?.reproduce?.steps?.length));
const fixedBefore = computed(() => fixPlan.value?.fixedBefore ?? []);
const fixSections = computed<FixSectionKey[]>(() => {
  const s: FixSectionKey[] = ['diagnosis'];
  if (fixedBefore.value.length) s.push('fixed-before');
  if (hasLocatorPanel.value) s.push('locator-fix');
  if (showVerify.value) s.push('verify');
  if (showReproduce.value) s.push('reproduce');
  if (fixPlan.value) s.push('fix-plan');
  return s;
});

// ── Apply the same triage ─────────────────────────────────────────────────────
// One click copies an earlier resolved cluster's triage note onto this one,
// prefixed so the history reads as an intentional reuse. The status is left as
// it is — a new cluster is never marked resolved because an old one was.
const applyingId = ref<number | null>(null);
const applyToast = useToast();
async function applyTriage(match: FixedBeforeMatchType) {
  if (!cluster.value || applyingId.value != null) return;
  applyingId.value = match.clusterId;
  const excerpt = (match.triageNote ?? match.diagnosisTitle ?? match.reason).replace(/\s+/g, ' ').trim().slice(0, 280);
  const prefix = `Same as cluster #${match.clusterId}: `;
  const existing = cluster.value.triageNote?.trim();
  const line = `${prefix}${excerpt}`;
  const triageNote = existing ? `${existing}\n${line}` : line;
  try {
    await $fetch(`/api/failure-clusters/${clusterId}/status`, {
      method: 'PATCH',
      body: { status: cluster.value.status, triageNote },
    });
    applyToast.add({ title: `Applied triage from cluster #${match.clusterId}`, color: 'success' });
    refresh();
  } catch {
    applyToast.add({ title: 'Could not apply the triage', color: 'error' });
  } finally {
    applyingId.value = null;
  }
}

// The diagnosis panel exposes its context/prompt actions for the page's More menu.
const diagnosisPanel = ref<{ openContext: () => void; copyPrompt: () => void; openHistory: () => void } | null>(null);
const { aiStatus } = useAiStatus();

const { copy: copyMarkdown, copied: markdownCopied } = useCopy();
function copyFixPlanMarkdown() {
  if (!fixPlan.value) return;
  const url = typeof window !== 'undefined' ? window.location.href : undefined;
  copyMarkdown(fixPlanToMarkdown(fixPlan.value, { url }), { toast: 'Fix plan copied as Markdown' });
}

// ── Bulk actions (More menu) ─────────────────────────────────────────────────
const quarantineAll = ref<{ trigger: () => void } | null>(null);
const pendingQuarantine = computed(() => affectedCases.value.filter((c) => !c.quarantined));

const moreMenuItems = computed(() => {
  const items: { label: string; icon: string; color?: 'warning'; onSelect: () => void }[] = [];
  if (canWrite.value && pendingQuarantine.value.length > 0)
    items.push({
      label: 'Quarantine all affected tests',
      icon: 'i-lucide-shield-alert',
      color: 'warning',
      onSelect: () => quarantineAll.value?.trigger(),
    });
  if (aiStatus.value?.configured)
    items.push({
      label: 'Show context',
      icon: 'i-lucide-eye',
      onSelect: () => diagnosisPanel.value?.openContext(),
    });
  items.push({
    label: 'Copy prompt',
    icon: 'i-lucide-clipboard-copy',
    onSelect: () => diagnosisPanel.value?.copyPrompt(),
  });
  if (rerunInfo.value?.available && retryCommand.value)
    items.push({
      label: 'Copy retry command',
      icon: 'i-lucide-clipboard',
      onSelect: () => copyRetry(retryCommand.value, { toast: 'Retry command copied' }),
    });
  items.push({ label: 'Copy summary', icon: 'i-lucide-clipboard-list', onSelect: copyCluster });
  items.push({ label: 'Refresh', icon: 'i-lucide-refresh-cw', onSelect: refresh });
  return items;
});

// ── Section locator ──────────────────────────────────────────────────────────
// A clue or diagnosis citation reveals the evidence it came from: the evidence
// tabs handle the tabbed sections, the fix plan and the raw error scroll in place.
const fixCardEl = ref<HTMLElement | null>(null);
const scmEl = ref<HTMLElement | null>(null);
const evidenceTabs = ref<{ revealSection: (id: string) => boolean } | null>(null);

function scrollToEl(el: HTMLElement | null) {
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const pageSections: Record<string, () => void> = {
  fixPlan: () => scrollToEl(fixCardEl.value),
  sampleError: revealRawError,
  executionError: revealRawError,
  scmInvestigation: () => scmEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  selectedCommits: () => scmEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  topSuspectedCommit: () => scmEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
  failingAction: () => scmEl.value?.scrollIntoView({ behavior: 'smooth', block: 'start' }),
};
provide(clusterSectionLocatorKey, {
  canLocate: (id: string) => id in pageSections || id in EVIDENCE_SECTION_TAB,
  open: (id: string) => {
    if (id in pageSections) pageSections[id]!();
    else evidenceTabs.value?.revealSection(id);
  },
});

// Deep link from the execution page's "Open fix plan" — scroll to the Fix card.
onMounted(() => {
  if (route.hash === '#fix-plan') nextTick(() => scrollToEl(fixCardEl.value));
});

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
          <BreadcrumbNav :items="breadcrumbItems" />
        </template>
        <template #right>
          <ShareLinksModal
            v-if="cluster && !isDemoMode"
            :endpoint="`/api/failure-clusters/${cluster.id}/share-links`"
          />
          <ExportMenu
            v-if="cluster"
            :endpoint="`/api/failure-clusters/${cluster.id}/export`"
            :base-name="`piwi-cluster-${cluster.id}`"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="cluster" class="flex flex-col gap-4 p-4 max-w-6xl mx-auto w-full">
        <!-- ── Header ─────────────────────────────────────────────────── -->
        <DetailHeader :title="clusterName">
          <template #primary>
            <UButton
              v-if="rerunInfo?.available"
              size="xs"
              color="primary"
              variant="subtle"
              icon="i-lucide-refresh-cw"
              :loading="rerunning"
              :title="rerunInfo?.reason ?? 'Re-run the affected tests in CI'"
              @click="triggerRerun"
            >
              <span class="hidden sm:inline">Re-run in CI</span>
            </UButton>
            <UButton
              v-else-if="retryCommand"
              size="xs"
              color="warning"
              variant="subtle"
              :icon="retryCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
              :title="retryCopied ? 'Copied!' : copyPreview(retryCommand)"
              aria-label="Copy retry command"
              @click="copyRetry(retryCommand, { toast: 'Retry command copied' })"
            >
              <span class="hidden sm:inline">Copy retry command</span>
            </UButton>
          </template>

          <template #menu>
            <UDropdownMenu :items="moreMenuItems">
              <UButton
                size="sm"
                color="neutral"
                variant="ghost"
                icon="i-lucide-ellipsis-vertical"
                aria-label="More actions"
                title="More actions"
              />
            </UDropdownMenu>
          </template>

          <template #facts>
            <UBadge
              v-if="cluster.errorType"
              :color="clusterErrorTypeColor(cluster.errorType)"
              variant="subtle"
              size="sm"
            >
              {{ cluster.errorType }}
            </UBadge>
            <span class="tabular-nums"
              >{{ cluster.occurrences }} occurrence{{ cluster.occurrences === 1 ? '' : 's' }}</span
            >
            <span class="tabular-nums"
              >{{ cluster.affectedTests }} {{ cluster.affectedTests === 1 ? 'test' : 'tests' }}</span
            >
            <span class="inline-flex items-center gap-1">
              first seen
              <NuxtLink :to="`/test-runs/${cluster.firstSeenRunId}`" class="text-primary hover:underline">
                run #{{ cluster.firstSeenRunId }}
              </NuxtLink>
              <ClientOnly>
                <span v-if="cluster.firstSeenAt" class="text-dimmed"
                  >({{ formatRelativeTime(cluster.firstSeenAt) }})</span
                >
              </ClientOnly>
            </span>
            <span class="inline-flex items-center gap-1">
              last seen
              <NuxtLink :to="`/test-runs/${cluster.lastSeenRunId}`" class="text-primary hover:underline">
                run #{{ cluster.lastSeenRunId }}
              </NuxtLink>
              <ClientOnly>
                <span v-if="cluster.lastSeenAt" class="text-dimmed"
                  >({{ formatRelativeTime(cluster.lastSeenAt) }})</span
                >
              </ClientOnly>
            </span>
            <span
              v-if="cluster.owner"
              class="inline-flex items-center gap-1"
              :title="`Owner from ${cluster.owner.source}`"
            >
              <UIcon name="i-lucide-user-round" class="size-3.5 shrink-0" />
              {{ cluster.owner.name }}
            </span>
            <a
              v-if="knownIssue"
              :href="knownIssue.url"
              target="_blank"
              rel="noopener noreferrer"
              class="inline-flex items-center gap-1 text-primary hover:underline"
              :title="knownIssue.title ?? knownIssue.url"
            >
              <UIcon name="i-lucide-link" class="size-3.5 shrink-0" />
              {{ knownIssue.key || knownIssue.provider }}
            </a>
          </template>

          <template #details>
            <div class="space-y-1">
              <p class="text-xs font-medium text-muted uppercase tracking-wide">Owner</p>
              <ClusterOwnerLine :owner="cluster.owner" :project-id="cluster.project?.id ?? null" />
            </div>
            <div class="space-y-1">
              <div class="flex items-center gap-1.5 text-xs">
                <UIcon name="i-lucide-link" class="size-3.5 shrink-0 text-gray-400" />
                <span class="text-muted uppercase tracking-wide font-medium">Known issue</span>
                <HelpHint topic="cluster.known-issue" />
              </div>
              <EntityLinks
                entity-type="failure_cluster"
                :entity-id="cluster.id"
                :links="cluster.links"
                :readonly="!canWrite"
                @updated="refresh"
              />
            </div>
          </template>

          <template #below>
            <TriageControl :cluster="cluster" :can-write="canWrite" @saved="refresh" />
          </template>
        </DetailHeader>

        <!-- ── What broke, in one line ────────────────────────────────── -->
        <template v-if="clusterVerdict">
          <TestCaseHeadlineCard :verdict="clusterVerdict" :top-clue="topClue" :provenance="headlineProvenance">
            <!-- The cluster's identity facts live in the header facts line above;
                 the headline stays the explanation, so its own fact row is empty. -->
            <template #facts><span class="hidden" /></template>
          </TestCaseHeadlineCard>
        </template>
        <UCard v-else>
          <h2 class="text-lg font-semibold text-highlighted">{{ clusterName }}</h2>
          <p v-if="headlineProvenance" class="text-xs text-dimmed mt-1">{{ headlineProvenance }}</p>
        </UCard>

        <!-- Show raw error: the verbatim sample error and the signature -->
        <div ref="rawErrorEl" class="scroll-mt-4">
          <UButton
            variant="link"
            color="neutral"
            size="xs"
            :icon="rawErrorOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            @click="rawErrorOpen = !rawErrorOpen"
          >
            Show raw error
          </UButton>
          <div v-if="rawErrorOpen" class="mt-2 space-y-2">
            <div
              v-if="cluster.sampleError"
              class="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto rounded bg-red-50 dark:bg-red-950/20 p-3"
              v-html="renderAnsi(cluster.sampleError)"
            />
            <p v-if="signatureLine" class="font-mono text-xs break-all text-muted">{{ signatureLine }}</p>
          </div>
        </div>

        <!-- Deterministic clues beyond the strongest (which sits in the headline) -->
        <CluesCard v-if="otherClues.length" :clues="otherClues" :failure-at="cluesFailureAt" title="Other clues" />

        <!-- ── Evidence ───────────────────────────────────────────────── -->
        <div v-if="selectedExecId" class="space-y-2">
          <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-sm">
            <span class="text-muted">from:</span>
            <USelect
              v-if="affectedCases.length > 1"
              v-model="selectedCaseId"
              :items="affectedCases.map((c) => ({ label: c.title, value: c.testCaseId }))"
              size="sm"
              class="min-w-0 max-w-xs"
              aria-label="Affected test"
            />
            <span v-else class="font-medium text-highlighted truncate">{{ selectedCase?.title }}</span>
            <span v-if="selectedRunId" class="text-muted">·</span>
            <NuxtLink
              v-if="selectedRunId"
              :to="`/test-runs/${selectedRunId}`"
              class="text-primary hover:underline tabular-nums"
            >
              run #{{ selectedRunId }}
            </NuxtLink>
            <span class="text-muted">·</span>
            <NuxtLink
              :to="`/test-run-cases/${selectedExecId}`"
              class="inline-flex items-center gap-1 text-primary hover:underline"
            >
              Open execution <UIcon name="i-lucide-arrow-right" class="size-3.5" />
            </NuxtLink>
          </div>
          <EvidenceTabs
            v-if="execution"
            ref="evidenceTabs"
            :test-case="execution"
            :traces="execTraces ?? []"
            :has-trace="hasTrace"
            :default-section="topClueSection"
            help="cluster.evidence"
          />
        </div>

        <!-- ── Fix: diagnosis, locator fix, verify, fix plan ──────────── -->
        <div ref="fixCardEl" class="scroll-mt-4">
          <FixCard :sections="fixSections" help="cluster.fix-plan">
            <!-- Diagnosis — the unified panel; result shows with or without a provider -->
            <template #diagnosis>
              <div data-shot="cluster-diagnosis">
                <DiagnosisPanel
                  ref="diagnosisPanel"
                  scope="cluster"
                  context-in-menu
                  :cluster-id="clusterId"
                  :last-seen-run-id="cluster.lastSeenRunId"
                  :cluster-status="cluster.status"
                  :fix-verification="cluster.fixVerification"
                  :last-seen-at="cluster.lastSeenAt"
                  :affected-test-cases="cluster.affectedTestCases ?? []"
                />
              </div>
            </template>

            <!-- Fixed before — resolved clusters this one resembles, and how each was fixed -->
            <template v-if="fixedBefore.length" #fixed-before-label>
              <span class="inline-flex items-center gap-1">Fixed before <HelpHint topic="cluster.fixed-before" /></span>
            </template>
            <template v-if="fixedBefore.length" #fixed-before>
              <FixedBeforeMatches
                :matches="fixedBefore"
                :can-write="canWrite"
                :applying-id="applyingId"
                @apply="applyTriage"
              />
            </template>

            <!-- Locator fix — the recommendation, its provenance and alternatives, once -->
            <template #locator-fix>
              <LocatorHealingPanel
                :run-id="cluster.lastSeenRunId"
                :test-runs-case-id="affectedCases[0]!.recentTestRunsCaseId"
                :affected-count="affectedCases.length"
                :chrome="false"
              />
            </template>

            <!-- Verify — the command and how to re-run it (the header carries Re-run in CI) -->
            <template v-if="fixPlan" #verify>
              <div class="space-y-1.5">
                <CodeBlock :code="fixPlan.verify.command" lang="bash" />
                <p class="text-xs text-muted">{{ fixPlan.verify.expectation }}</p>
                <div class="flex flex-wrap items-center gap-2">
                  <DesktopRunLocallyButton
                    :project-id="cluster.project?.id"
                    :project-label="cluster.project?.label ?? cluster.project?.name"
                    :cases="affectedRetryCases"
                  />
                  <ClientOnly>
                    <span v-if="rerunInfo?.lastDispatch" class="text-xs text-muted">
                      Last re-run {{ formatRelativeTime(rerunInfo.lastDispatch.at) }}
                      <template v-if="rerunInfo.lastDispatch.byName">by {{ rerunInfo.lastDispatch.byName }}</template>
                    </span>
                  </ClientOnly>
                </div>
              </div>
            </template>

            <!-- Reproduce — the local recipe and a generated git bisect -->
            <template v-if="showReproduce" #reproduce-label>
              <span class="inline-flex items-center gap-1">Reproduce <HelpHint topic="fix.reproduce" /></span>
            </template>
            <template v-if="fixPlan && showReproduce" #reproduce>
              <ReproduceSection
                :reproduce="fixPlan.reproduce"
                :bisect="fixPlan.bisect"
                :context="fixPlan.reproduceDesktop"
                :project-label="cluster?.project?.label ?? cluster?.project?.name"
              />
            </template>

            <!-- Fix plan — the whole plan assembled for a ticket or an agent -->
            <template v-if="fixPlan" #fix-plan-actions>
              <UButton
                size="xs"
                color="neutral"
                variant="outline"
                :icon="markdownCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
                title="Copy the whole plan as Markdown for a ticket or an agent"
                @click="copyFixPlanMarkdown"
              >
                Copy as Markdown
              </UButton>
            </template>
            <template v-if="fixPlan" #fix-plan>
              <p class="flex items-center gap-1 text-xs text-muted">
                <UIcon name="i-lucide-bot" class="size-3 shrink-0" />
                The diagnosis, edits, failing tests, owner and verify command in one document —
                <code class="font-mono">get_fix_plan</code> returns the same to your AI agent via the
                <NuxtLink to="/mcp" class="text-primary hover:underline">MCP server</NuxtLink>.
              </p>
            </template>
          </FixCard>
        </div>

        <!-- ── What changed: baseline picker + commit diff ────────────── -->
        <div ref="scmEl" class="scroll-mt-4">
          <SectionCard icon="i-lucide-git-compare-arrows" title="What changed" help="cluster.scm">
            <ClusterInvestigation />
          </SectionCard>
        </div>

        <!-- ── Affected tests ─────────────────────────────────────────── -->
        <ClusterAffectedTests
          :cluster-id="clusterId"
          :cases="cluster.affectedTestCases ?? []"
          :can-write="canWrite"
          :project-id="cluster.project?.id"
          :project-key="cluster.project?.id"
          :project-name="cluster.project?.name"
          @changed="refresh"
        />

        <!-- ── History ────────────────────────────────────────────────── -->
        <ClusterHistory :cluster="cluster" @open-history="diagnosisPanel?.openHistory()" />
      </div>

      <ErrorState v-else text="Cluster not found." icon="i-lucide-search-x" class="h-64">
        <template #action>
          <UButton to="/projects" size="xs" color="neutral" variant="outline">Back to projects</UButton>
        </template>
      </ErrorState>
    </template>
  </UDashboardPanel>

  <!-- Bulk actions triggered from the More menu. -->
  <QuarantineAllButton
    v-if="cluster && canWrite"
    ref="quarantineAll"
    hide-trigger
    :project-id="cluster.project?.id"
    :cases="cluster.affectedTestCases ?? []"
    :reason="`Quarantined from cluster #${cluster.id}`"
    @changed="refresh"
  />
</template>
