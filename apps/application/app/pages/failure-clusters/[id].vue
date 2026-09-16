<script setup lang="ts">
import { describeCluster, clusterSignatureLine, headlineAddsValue } from '#shared/describe-cluster';
import { caseHeadline, type FailureVerdict } from '#shared/failure-verdict';
import { parsePlaywrightError } from '#shared/error-parse';
import type { FailureCluesResult } from '#shared/handlers/test-cases';
import type { ComponentPublicInstance } from 'vue';
import type { FailureClusterDetail, TraceInfo } from '~~/types/api';
import type { FixPlan } from '#shared/fix-plan.types';
import { fixPlanToMarkdown } from '#shared/fix-plan-markdown';
import type { FixSectionKey } from '~/components/shared/Toolbox.vue';
import type { RerunInfo } from '~/composables/useCiRerun';
import { renderAnsi } from '~/utils';
import { stripAnsi } from '~/utils/text-format';
import { buildRetryCommand } from '~/utils/retry-command';
import { clusterSectionLocatorKey } from '~/composables/useClusterSectionLocator';
import { EVIDENCE_SECTION_TAB } from '~/utils/evidence-sections';
import { relativeTimeAgo, durationApprox, toEpochMs } from '#shared/relative-time';

const route = useRoute();
const clusterId = parseInt(String(route.params.id));
// Share links need the server; the public demo has no share-link routes.
const isDemoMode = Boolean(useRuntimeConfig().public.demoMode);

// Quarantine/triage actions on the cluster are reporter/admin only, matching the endpoint.
const { canWrite } = useAuth();

// Provide shared diagnosis/investigation state (consumed by WhatChangedLine,
// ClusterInvestigation and DiagnosisPanel). Must run before the top-level await
// below so provide() and lifecycle hooks register against the active setup
// instance. The page keeps the one flag it renders on: whether the What
// changed card has anything to show.
const { hasChangesToShow } = provideClusterDiagnosis(clusterId);

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
      : Promise.resolve({ clues: [], story: null, failureAt: null }),
  { default: (): FailureCluesResult => ({ clues: [], story: null, failureAt: null }), watch: [selectedExecId] },
);

const clues = computed(() => cluesData.value?.clues ?? []);
const story = computed(() => cluesData.value?.story ?? null);
const cluesFailureAt = computed(() => cluesData.value?.failureAt ?? null);
// The evidence opens on the story: the first member clue's cited section and the
// story's strength (or the top clue's, when no combination matched).
const defaultHint = useEvidenceHint(clues, story);
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
      fixedBefore: null,
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

// The latest occurrence's headline earns a second, smaller line only when it
// carries a value the name lacks (an expected/received pair, a timeout, a count).
const headlineText = computed(() => clusterVerdict.value?.parts.map((p) => p.text).join('') ?? '');
const showSecondHeadline = computed(() => headlineAddsValue(clusterName.value, headlineText.value));

// ── Cluster state, occurrences and the next step (served on the endpoint) ────
const clusterState = computed(() => cluster.value?.clusterState ?? null);
const occurrenceSeries = computed(() => cluster.value?.occurrenceSeries ?? []);
const nextStep = computed(() => cluster.value?.nextStep ?? null);

// The completed diagnosis leads the story line on the cluster page.
const clusterDiagnosis = computed(() => {
  const d = cluster.value?.diagnosis;
  return d && d.status === 'completed' && d.summary ? { summary: d.summary, confidence: d.confidence ?? null } : null;
});

// The occurrence sentence: the span (first → last) is stable, the "last X ago" is
// client-only so the server and browser time zones never disagree.
const occurrenceSpan = computed(() => {
  const c = cluster.value;
  const first = toEpochMs(c?.firstSeenAt ?? null);
  const last = toEpochMs(c?.lastSeenAt ?? null);
  if (first == null || last == null || last - first < 60_000) return null;
  return durationApprox(last - first);
});
const occurrenceCountText = computed(() => {
  const c = cluster.value;
  if (!c) return '';
  const occ = `${c.occurrences} occurrence${c.occurrences === 1 ? '' : 's'}`;
  const tests = `${c.affectedTests} test${c.affectedTests === 1 ? '' : 's'}`;
  return `${occ} in ${tests}${occurrenceSpan.value ? ` over ${occurrenceSpan.value}` : ''}`;
});
const lastSeenAgo = computed(() => relativeTimeAgo(cluster.value?.lastSeenAt ?? null));
const occurrenceAria = computed(() =>
  [occurrenceCountText.value, lastSeenAgo.value ? `last ${lastSeenAgo.value}` : null].filter(Boolean).join(' · '),
);

// The newest known-issue link, shown compactly on the facts line.
const knownIssue = computed(() => cluster.value?.links?.[0] ?? null);

// The facts line carries the raw-error disclosure; a citation reveals it through
// the exposed method.
const factsLine = ref<{ revealRawError: () => void } | null>(null);

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
const { copy: copyRetry } = useCopy();

const { data: rerunInfo, refresh: refreshRerun } = await useFetch<RerunInfo>(
  `/api/failure-clusters/${clusterId}/rerun`,
);
const { rerunning, triggerRerun } = useCiRerun(clusterId, refreshRerun);

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

// ── Folded one-line summaries for the toolbox sections ───────────────────────
const diagnosisSummary = computed(() => diagnosisSectionSummary(cluster.value?.diagnosis, aiStatus.value?.configured));
const reproduceSummary = computed(() =>
  reproduceSectionSummary(fixPlan.value?.reproduce?.steps?.length ?? 0, Boolean(fixPlan.value?.bisect?.available)),
);
const verifySummary = computed(() =>
  verifySectionSummary(fixPlan.value?.verify?.command ?? '', Boolean(rerunInfo.value?.available), 'The verify command'),
);

// ── Apply the same triage ─────────────────────────────────────────────────────
const { applyingId, applyTriage } = useApplyClusterTriage({
  clusterId: () => clusterId,
  status: () => cluster.value?.status,
  currentNote: () => cluster.value?.triageNote,
  onApplied: () => refresh(),
});

// The diagnosis panel exposes its context/prompt actions for the page's More menu.
const diagnosisPanel = ref<{
  openContext: () => void;
  copyPrompt: () => void;
  openHistory: () => void;
  reDiagnose?: () => void;
} | null>(null);
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
  if (rerunInfo.value?.available)
    items.push({
      label: 'Re-run in CI',
      icon: 'i-lucide-refresh-cw',
      onSelect: () => void triggerRerun(),
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
const scmEl = ref<HTMLElement | null>(null);
const whatChangedLine = ref<ComponentPublicInstance | null>(null);
const evidenceTabs = ref<{
  revealSection: (id: string) => boolean;
  selectTab: (t: string) => void;
} | null>(null);
const clusterLocatorPanel = ref<{
  copyPatch: () => void;
  copyRecommendedLocator: () => void;
  openPicker: () => void;
  expandAlternatives: () => void;
} | null>(null);
const toolbox = ref<{ scrollToSection: (k: FixSectionKey) => void } | null>(null);

function scrollToEl(el: HTMLElement | null) {
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
function openFixPlan() {
  toolbox.value?.scrollToSection('fix-plan');
}
const scrollToScm = () => scrollToEl(scmEl.value);

const pageSections: Record<string, () => void> = {
  fixPlan: openFixPlan,
  sampleError: () => factsLine.value?.revealRawError(),
  executionError: () => factsLine.value?.revealRawError(),
  scmInvestigation: scrollToScm,
  selectedCommits: scrollToScm,
  topSuspectedCommit: scrollToScm,
  failingAction: scrollToScm,
};
provide(clusterSectionLocatorKey, {
  canLocate: (id: string) => id in pageSections || id in EVIDENCE_SECTION_TAB,
  open: (id: string) => {
    if (id in pageSections) pageSections[id]!();
    else evidenceTabs.value?.revealSection(id);
  },
});

// ── Next step: turn one action id into the real behaviour ────────────────────
// The next-step line stays presentation-only; the page owns the wiring through
// the shared composable, reusing the same panels the toolbox does. Page-specific
// targets are callbacks.
const { quarantineOne } = useQuarantine(() => cluster.value?.project?.id ?? null);
const { setClusterStatus } = useClusterTriage(clusterId, { onSaved: () => refresh() });

const { handle: handleNextStepAction } = useNextStepActions({
  clusterId: () => clusterId,
  fixPlanPatch: () => fixPlan.value?.diagnosis?.patch ?? null,
  ideProject: () => cluster.value?.project ?? null,
  locatorPanel: () => clusterLocatorPanel.value,
  reproRecipe: () => fixPlan.value?.reproduce ?? null,
  diagnosisContextEndpoint: () => `/api/failure-clusters/${clusterId}/context`,
  scrollToSection: (k) => toolbox.value?.scrollToSection(k),
  selectAttemptsTab: () => evidenceTabs.value?.selectTab('attempts'),
  setClusterStatus,
  quarantine: async () => {
    if (selectedCase.value) {
      const ok = await quarantineOne(selectedCase.value.testCaseId, `Quarantined from cluster #${clusterId}`);
      if (ok) refresh();
    }
  },
  rerunInCi: () => triggerRerun(),
  whatChanged: () => scrollToEl(scmEl.value ?? whatChangedLine.value?.$el ?? null),
  reDiagnose: () => {
    toolbox.value?.scrollToSection('diagnosis');
    diagnosisPanel.value?.reDiagnose?.();
  },
});

// Deep link from the execution page's fix-plan link — open the fix-plan section.
onMounted(() => {
  if (route.hash === '#fix-plan') nextTick(() => openFixPlan());
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
      <div v-if="cluster" class="flex flex-col gap-4 p-4 max-sm:px-0 max-w-6xl mx-auto w-full">
        <!-- ── One block: identity, name, most likely, occurrences, what changed, state, next ── -->
        <SituationBlock help="cluster.state">
          <!-- Line 1: identity kicker — cluster #, error type, project, owner, known issue -->
          <template #identity>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span class="text-highlighted">Failure cluster #{{ clusterId }}</span>
              <template v-if="cluster.errorType">
                <span aria-hidden="true">·</span>
                <span>{{ cluster.errorType }}</span>
              </template>
              <template v-if="cluster.project">
                <span aria-hidden="true">·</span>
                <NuxtLink :to="`/projects/${cluster.project.id}?tab=failure-clusters`" :class="SENTENCE_LINK_CLASS">
                  {{ cluster.project.label || cluster.project.name }}
                </NuxtLink>
              </template>
              <template v-if="cluster.owner">
                <span aria-hidden="true">·</span>
                <span :title="`Owner from ${cluster.owner.source}`">{{ cluster.owner.name }}</span>
              </template>
              <span v-if="knownIssue" aria-hidden="true">·</span>
              <a
                v-if="knownIssue"
                :href="knownIssue.url"
                target="_blank"
                rel="noopener noreferrer"
                :class="SENTENCE_LINK_CLASS"
                :title="knownIssue.title ?? knownIssue.url"
              >
                {{ knownIssue.key || knownIssue.provider }}
              </a>
            </div>
          </template>

          <!-- Actions: the More menu the header used to carry -->
          <template #actions>
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

          <!-- Line 2: the cluster name as the h1; the latest headline as a second line only when it adds value -->
          <template #headline>
            <h1 class="text-lg sm:text-xl font-semibold leading-snug text-highlighted break-words">
              {{ clusterName }}
            </h1>
            <p
              v-if="clusterVerdict && showSecondHeadline"
              data-shot="failure-headline"
              class="text-sm text-muted mt-1 flex flex-wrap items-baseline gap-x-2"
            >
              <span class="min-w-0"><FailureHeadline :parts="clusterVerdict.parts" plain /></span>
              <span v-if="headlineProvenance" class="text-xs shrink-0">{{ headlineProvenance }}</span>
            </p>
          </template>

          <!-- Line 3: most likely — the diagnosis leads when it completed, else the story -->
          <template v-if="clusterDiagnosis || story || clues.length" #story>
            <StoryLine :story="story" :clues="clues" :failure-at="cluesFailureAt" :diagnosis="clusterDiagnosis" />
          </template>

          <!-- Occurrences: the sparkline and its sentence -->
          <template #occurrences>
            <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
              <OccurrenceSparkline
                v-if="occurrenceSeries.length"
                :series="occurrenceSeries"
                :label="`Occurrences per run — ${occurrenceAria}`"
              />
              <span>
                {{ occurrenceCountText }}
                <ClientOnly
                  ><template v-if="lastSeenAgo"> · last {{ lastSeenAgo }}</template></ClientOnly
                >
              </span>
            </div>
          </template>

          <!-- What changed: the commits since the last passing run, in one line -->
          <template #whatChanged>
            <WhatChangedLine ref="whatChangedLine" @see="scrollToEl(scmEl)" />
          </template>

          <!-- State: one sentence with one verb, and the control that changes it -->
          <template v-if="clusterState" #state>
            <ClusterStateLine :cluster="cluster" :state="clusterState" :can-write="canWrite" @saved="refresh" />
          </template>

          <!-- Line 5: the next step -->
          <template v-if="nextStep" #next>
            <NextStepLine :next-step="nextStep" :retry-command="retryCommand" @action="handleNextStepAction" />
          </template>

          <!-- Line 6: the facts line — Details, Raw error, Copy summary -->
          <template #facts>
            <ClusterFactsLine
              ref="factsLine"
              :cluster="cluster"
              :can-write="canWrite"
              :signature-line="signatureLine"
              @refresh="refresh"
              @copy="copyCluster"
            />
          </template>
        </SituationBlock>

        <!-- ── What changed, in full: the baseline picker, the commits and the diff — only with something to show ── -->
        <div v-if="hasChangesToShow" ref="scmEl" class="scroll-mt-4">
          <ClusterInvestigation />
        </div>

        <!-- ── Affected tests: the evidence selector, above the evidence ── -->
        <ClusterAffectedTests
          v-model:selected-case-id="selectedCaseId"
          :cluster-id="clusterId"
          :cases="cluster.affectedTestCases ?? []"
          :can-write="canWrite"
          :selected-run-id="selectedRunId"
          :selected-exec-id="selectedExecId"
          :project-id="cluster.project?.id"
          :project-key="cluster.project?.id"
          :project-name="cluster.project?.name"
          @changed="refresh"
        />

        <!-- ── Evidence ───────────────────────────────────────────────── -->
        <div v-if="selectedExecId" class="scroll-mt-4">
          <EvidenceTabs
            v-if="execution"
            ref="evidenceTabs"
            :test-case="execution"
            :traces="execTraces ?? []"
            :has-trace="hasTrace"
            :default-hint="defaultHint"
            help="case.evidence"
          />
        </div>

        <!-- ── More ways to fix ───────────────────────────────────────── -->
        <div class="scroll-mt-4">
          <Toolbox ref="toolbox" :sections="fixSections" :next-step-kind="nextStep?.kind ?? null" help="fix.toolbox">
            <template #diagnosis-summary>{{ diagnosisSummary }}</template>
            <template #locator-fix-summary>Ranked replacement locators from the failing page</template>
            <template #verify-summary>{{ verifySummary }}</template>
            <template #reproduce-summary>{{ reproduceSummary }}</template>
            <template #fixed-before-summary
              >{{ fixedBefore.length }} similar resolved cluster{{ fixedBefore.length === 1 ? '' : 's' }}</template
            >
            <template #fix-plan-summary>Copy as Markdown · the same plan an agent gets from get_fix_plan</template>

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
                ref="clusterLocatorPanel"
                :run-id="cluster.lastSeenRunId"
                :test-runs-case-id="affectedCases[0]!.recentTestRunsCaseId"
                :affected-count="affectedCases.length"
                :chrome="false"
              />
            </template>

            <!-- Verify — the command and how to re-run it -->
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
          </Toolbox>
        </div>
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
