<script setup lang="ts">
import { describeCluster, clusterSignatureLine, headlineAddsValue } from '#shared/describe-cluster';
import { caseHeadline, type FailureVerdict } from '#shared/failure-verdict';
import { parsePlaywrightError } from '#shared/error-parse';
import type { FailureCluesResult } from '#shared/handlers/test-cases';
import type { FailureClusterDetail, TraceInfo } from '~~/types/api';
import type { FixPlan, FixedBeforeMatch as FixedBeforeMatchType } from '#shared/fix-plan.types';
import { fixPlanToMarkdown } from '#shared/fix-plan-markdown';
import type { FixSectionKey } from '~/components/shared/Toolbox.vue';
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
      : Promise.resolve({ clues: [], story: null, failureAt: null }),
  { default: (): FailureCluesResult => ({ clues: [], story: null, failureAt: null }), watch: [selectedExecId] },
);

const clues = computed(() => cluesData.value?.clues ?? []);
const story = computed(() => cluesData.value?.story ?? null);
const cluesFailureAt = computed(() => cluesData.value?.failureAt ?? null);
const topClue = computed(() => clues.value[0] ?? null);
const topClueSection = computed(() => topClue.value?.citations?.[0]?.section ?? null);
// The evidence opens on the story: the first member clue's cited section and the
// story's strength (or the top clue's, when no combination matched).
const defaultHint = computed<{ section: string | null; strength: 'strong' | 'medium' | 'weak' | null }>(() => {
  const s = story.value;
  if (s) {
    const first = clues.value.find((c) => c.id === s.clueIds[0]) ?? topClue.value;
    return { section: first?.citations?.[0]?.section ?? null, strength: s.strength };
  }
  return { section: topClueSection.value, strength: topClue.value?.strength ?? null };
});
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
const { copy: copyRetry } = useCopy();

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

// ── Folded one-line summaries for the toolbox sections ───────────────────────
const diagnosisSummary = computed(() => {
  const d = cluster.value?.diagnosis;
  if (d?.status === 'completed' && (d.summary || d.category)) {
    const title = d.summary ?? d.category ?? 'Diagnosed';
    return d.confidence ? `${title} · ${d.confidence} confidence` : title;
  }
  return aiStatus.value?.configured === false ? 'AI is not configured' : 'Not diagnosed yet';
});
const reproduceSummary = computed(() => {
  const steps = fixPlan.value?.reproduce?.steps?.length ?? 0;
  const bisect = fixPlan.value?.bisect?.available ? 'bisect available' : 'bisect not available';
  return `${steps} commands · Linux/macOS or Windows · ${bisect}`;
});
const verifySummary = computed(() => {
  const cmd = fixPlan.value?.verify?.command ?? '';
  const g = cmd.match(/-g\s+(".*?"|'.*?'|\S+)/)?.[1];
  const parts = [g ? `-g ${g}` : 'The verify command'];
  if (rerunInfo.value?.available) parts.push('Re-run in CI');
  return parts.join(' · ');
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
const fixCardEl = ref<HTMLElement | null>(null);
const scmEl = ref<HTMLElement | null>(null);
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

function scrollToEl(el: HTMLElement | null) {
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

const pageSections: Record<string, () => void> = {
  fixPlan: () => openFixPlan(),
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

// ── Next step: turn one action id into the real behaviour ────────────────────
// The next-step line stays presentation-only; the page owns the wiring through
// the shared composable, reusing the same panels the toolbox does. Page-specific
// targets are callbacks.
const nextStepToast = useToast();
const { quarantineOne } = useQuarantine(() => cluster.value?.project?.id ?? null);

/** Open a toolbox section and scroll to it (its body is otherwise folded away). */
const toolbox = ref<{ openSection: (k: string) => void } | null>(null);
function scrollToFixSection(key: 'diagnosis' | 'reproduce' | 'locator-fix' | 'fix-plan') {
  toolbox.value?.openSection(key);
  nextTick(() => {
    const el = import.meta.client ? document.querySelector<HTMLElement>(`[data-shot="fix-${key}"]`) : null;
    scrollToEl(el ?? fixCardEl.value);
  });
}
function openFixPlan() {
  scrollToFixSection('fix-plan');
}

async function setClusterStatus(status: 'open' | 'resolved') {
  try {
    await $fetch(`/api/failure-clusters/${clusterId}/status`, { method: 'PATCH', body: { status } });
    nextStepToast.add({
      title: status === 'resolved' ? 'Cluster marked resolved' : 'Cluster reopened',
      color: 'success',
    });
    refresh();
  } catch {
    nextStepToast.add({ title: 'Could not update the cluster', color: 'error' });
  }
}

const { handle: handleNextStepAction } = useNextStepActions({
  clusterId: () => clusterId,
  fixPlanPatch: () => fixPlan.value?.diagnosis?.patch ?? null,
  ideProject: () => cluster.value?.project ?? null,
  locatorPanel: () => clusterLocatorPanel.value,
  reproRecipe: () => fixPlan.value?.reproduce ?? null,
  diagnosisContextEndpoint: () => `/api/failure-clusters/${clusterId}/context`,
  scrollToDiagnosis: () => scrollToFixSection('diagnosis'),
  scrollToReproduce: () => scrollToFixSection('reproduce'),
  scrollToLocatorFix: () => scrollToFixSection('locator-fix'),
  selectAttemptsTab: () => evidenceTabs.value?.selectTab('attempts'),
  setClusterStatus,
  quarantine: async () => {
    if (selectedCase.value) {
      const ok = await quarantineOne(selectedCase.value.testCaseId, `Quarantined from cluster #${clusterId}`);
      if (ok) refresh();
    }
  },
  rerunInCi: () => triggerRerun(),
  openExecution: (id) => {
    navigateTo(`/test-run-cases/${id}`);
  },
  whatChanged: () => scrollToEl(scmEl.value),
  reDiagnose: () => {
    scrollToFixSection('diagnosis');
    diagnosisPanel.value?.reDiagnose?.();
  },
});

// Deep link from the execution page's "Open fix plan" — open the fix-plan section.
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
        <!-- ── One block: identity, name, most likely, occurrences, state, next ── -->
        <SituationBlock help="cluster.state">
          <!-- Line 1: identity kicker — cluster #, error type, project, owner, known issue -->
          <template #identity>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted">
              <span class="font-medium text-highlighted">Failure cluster #{{ clusterId }}</span>
              <UBadge
                v-if="cluster.errorType"
                :color="clusterErrorTypeColor(cluster.errorType)"
                variant="subtle"
                size="xs"
              >
                {{ cluster.errorType }}
              </UBadge>
              <NuxtLink
                v-if="cluster.project"
                :to="`/projects/${cluster.project.id}?tab=failure-clusters`"
                class="hover:text-primary hover:underline"
              >
                {{ cluster.project.label || cluster.project.name }}
              </NuxtLink>
              <span
                v-if="cluster.owner"
                class="inline-flex items-center gap-1"
                :title="`Owner from ${cluster.owner.source}`"
              >
                <UIcon name="i-lucide-user-round" class="size-3.5 shrink-0" />{{ cluster.owner.name }}
              </span>
              <a
                v-if="knownIssue"
                :href="knownIssue.url"
                target="_blank"
                rel="noopener noreferrer"
                class="inline-flex items-center gap-1 text-primary hover:underline"
                :title="knownIssue.title ?? knownIssue.url"
              >
                <UIcon name="i-lucide-link" class="size-3.5 shrink-0" />{{ knownIssue.key || knownIssue.provider }}
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
              <span class="min-w-0"><FailureHeadline :parts="clusterVerdict.parts" /></span>
              <span v-if="headlineProvenance" class="text-xs text-dimmed shrink-0">{{ headlineProvenance }}</span>
            </p>
          </template>

          <!-- Line 3: most likely — the diagnosis leads when it completed, else the story -->
          <template v-if="clusterDiagnosis || story || clues.length" #story>
            <StoryLine :story="story" :clues="clues" :failure-at="cluesFailureAt" :diagnosis="clusterDiagnosis" />
          </template>

          <!-- Line 4b: occurrence sparkline and sentence, then the state line -->
          <template #state>
            <div class="space-y-2.5">
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <OccurrenceSparkline
                  v-if="occurrenceSeries.length"
                  :series="occurrenceSeries"
                  :label="`Occurrences per run — ${occurrenceAria}`"
                />
                <span class="text-muted">
                  {{ occurrenceCountText }}
                  <ClientOnly
                    ><template v-if="lastSeenAgo"> · last {{ lastSeenAgo }}</template></ClientOnly
                  >
                </span>
              </div>
              <ClusterStateLine
                v-if="clusterState"
                :cluster="cluster"
                :state="clusterState"
                :can-write="canWrite"
                @saved="refresh"
              />
            </div>
          </template>

          <!-- Line 5: the next step -->
          <template v-if="nextStep" #next>
            <NextStepLine :next-step="nextStep" :retry-command="retryCommand" @action="handleNextStepAction" />
          </template>

          <!-- Line 6: the facts line — Details, Raw error, Copy summary -->
          <template #facts>
            <div class="flex items-center gap-x-3 gap-y-1 flex-wrap text-xs text-muted">
              <UPopover>
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  trailing-icon="i-lucide-chevron-down"
                  label="Details"
                  class="shrink-0"
                />
                <template #content>
                  <div class="p-3 space-y-3 text-sm w-72">
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
                  </div>
                </template>
              </UPopover>

              <button
                type="button"
                class="inline-flex items-center gap-1 text-primary hover:underline shrink-0"
                :aria-expanded="rawErrorOpen"
                @click="rawErrorOpen = !rawErrorOpen"
              >
                <UIcon :name="rawErrorOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
                Raw error
              </button>

              <button
                type="button"
                class="inline-flex items-center gap-1 hover:text-primary shrink-0"
                @click="copyCluster"
              >
                <UIcon name="i-lucide-clipboard-list" class="size-3.5" />Copy summary
              </button>
            </div>

            <div v-if="rawErrorOpen" ref="rawErrorEl" class="mt-2 space-y-2 scroll-mt-4">
              <div
                v-if="cluster.sampleError"
                class="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto rounded bg-red-50 dark:bg-red-950/20 p-3"
                v-html="renderAnsi(cluster.sampleError)"
              />
              <p v-if="signatureLine" class="font-mono text-xs break-all text-muted">{{ signatureLine }}</p>
            </div>
          </template>
        </SituationBlock>

        <!-- ── What changed: moved up under the block; one line when empty ── -->
        <div ref="scmEl" class="scroll-mt-4">
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
        <div ref="fixCardEl" class="scroll-mt-4">
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
