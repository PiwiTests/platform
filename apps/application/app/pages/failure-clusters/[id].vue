<script setup lang="ts">
import type { DropdownMenuItem } from '@nuxt/ui';
import { describeCluster, clusterSignatureLine, headlineAddsValue } from '#shared/describe-cluster';
import { caseHeadline, type FailureVerdict } from '#shared/failure-verdict';
import { parsePlaywrightError } from '#shared/error-parse';
import type { FailureCluesResult } from '#shared/handlers/test-cases';
import type { ComponentPublicInstance } from 'vue';
import type { FailureClusterDetail, TraceInfo } from '~~/types/api';
import type { FixPlan } from '#shared/fix-plan.types';
import type { LocatorHealingResult } from '#shared/locator-healing.types';
import { fixPlanToMarkdown } from '#shared/fix-plan-markdown';
import type { FixSectionKey } from '~/components/shared/Toolbox.vue';
import type { RerunInfo } from '~/composables/useCiRerun';
import { renderAnsi } from '~/utils';
import { stripAnsi } from '~/utils/text-format';
import { buildRetryCommand } from '~/utils/retry-command';
import { clusterSectionLocatorKey } from '~/composables/useClusterSectionLocator';
import { EVIDENCE_SECTION_TAB } from '~/utils/evidence-sections';
import { relativeTimeAgo, durationApprox, toEpochMs } from '#shared/relative-time';
import { safeHttpUrl } from '#shared/utils/safe-url';
import { getProviderIcon, type LinkProvider } from '#shared/link-detect';
import { issueLineForm } from '~/utils/issue-line';

const route = useRoute();
const clusterId = parseInt(String(route.params.id));
// Share links need the server; the public demo has no share-link routes.
const isDemoMode = Boolean(useRuntimeConfig().public.demoMode);

// What the viewer may do on the cluster's project, matching each action's route.
const { can } = useAuth();

// Provide shared diagnosis/investigation state (consumed by WhatChangedLine,
// ClusterInvestigation and DiagnosisPanel). Must run before the top-level await
// below so provide() and lifecycle hooks register against the active setup
// instance. The page keeps the one flag it renders on: whether the What
// changed card has anything to show.
const { hasChangesToShow } = provideClusterDiagnosis(clusterId);

const { data: cluster, refresh: refreshCluster } = await useFetch<FailureClusterDetail>(
  `/api/failure-clusters/${clusterId}`,
);
const clusterProjectId = computed(() => cluster.value?.project?.id ?? null);
const canTriage = computed(() => can('triage:write', clusterProjectId.value));
const canQuarantine = computed(() => can('quarantine:write', clusterProjectId.value));
const canRerun = computed(() => can('run:control', clusterProjectId.value));

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

// Server-rendered fetches carry the viewer's session.
const requestFetch = useRequestFetch();
const { data: execution } = await useAsyncData<Record<string, unknown> | null>(
  `cluster-selected-exec-${clusterId}`,
  () =>
    selectedExecId.value
      ? requestFetch<Record<string, unknown>>(`/api/test-run-cases/${selectedExecId.value}`)
      : Promise.resolve(null),
  { watch: [selectedExecId] },
);
const { data: execTraces } = await useAsyncData<TraceInfo[]>(
  `cluster-selected-traces-${clusterId}`,
  () =>
    selectedExecId.value
      ? requestFetch<{ items: TraceInfo[] }>(`/api/test-run-cases/${selectedExecId.value}/traces`).then((r) => r.items)
      : Promise.resolve([]),
  { default: (): TraceInfo[] => [], watch: [selectedExecId] },
);
const { data: cluesData } = await useAsyncData<FailureCluesResult>(
  `cluster-selected-clues-${clusterId}`,
  () =>
    selectedExecId.value
      ? requestFetch<FailureCluesResult>(`/api/test-run-cases/${selectedExecId.value}/clues`)
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
// Where that second line comes from, on hover.
const headlineTitle = computed(() => (headlineProvenance.value ? `From the ${headlineProvenance.value}` : undefined));

// The name as prose and the locators written into it, each rendered as code.
const clusterNameParts = computed(() => splitLocatorParts(clusterName.value));

// ── Cluster state, occurrences and the next step (served on the endpoint) ────
const clusterState = computed(() => cluster.value?.clusterState ?? null);
// The situation block's edge, in the color the state line's dot carries.
const stateEdge = computed(() => clusterStateColor(clusterState.value?.kind).edge);
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

// The cluster's known issue (the newest tracker link), one rule for every place
// that names it, and the Issue line's form.
const knownIssue = computed(() => cluster.value?.knownIssue ?? null);
const { hasTracker } = useTrackerStatus();
const canFileIssue = computed(() => hasTracker.value && can('issue:create', clusterProjectId.value));
const canLinkIssue = computed(() => can('link:write', clusterProjectId.value));
const issueForm = computed(() =>
  issueLineForm({
    hasKnownIssue: Boolean(knownIssue.value),
    filingQueued: Boolean(cluster.value?.issueFilingQueued),
    clusterStatus: cluster.value?.status,
    snoozed: clusterState.value?.kind === 'snoozed',
    canFile: canFileIssue.value,
    canLink: canLinkIssue.value,
  }),
);
const issueModalOpen = ref(false);
const linkIssueOpen = ref(false);
function onIssueChanged() {
  issueModalOpen.value = false;
  linkIssueOpen.value = false;
  refresh();
}

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

  const issue = knownIssue.value;
  const tracked = issue ? `Tracked in ${issue.key}${issue.status ? ` (${issue.status})` : ''}: ${issue.url}` : null;

  const plain = [
    `❌ Failure cluster: ${clusterName.value}`,
    ...(clusterName.value !== c.signature ? [`Signature: ${c.signature}`] : []),
    meta,
    ...(tracked ? [tracked] : []),
    '',
    ...(c.sampleError ? ['Sample error:', stripAnsi(c.sampleError), ''] : []),
    ...(aiSummary ? [aiSummary, ''] : []),
    `Cluster: ${url}`,
  ].join('\n');

  const html = [
    `<p><strong>❌ Failure cluster</strong>: ${esc(clusterName.value)}</p>`,
    clusterName.value !== c.signature ? `<p><code>${esc(c.signature)}</code></p>` : '',
    `<p><em>${esc(meta)}</em></p>`,
    issue
      ? `<p>Tracked in <a href="${esc(issue.url)}">${esc(issue.key)}</a>${issue.status ? ` (${esc(issue.status)})` : ''}</p>`
      : '',
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
// It reads the latest occurrence, the execution the next step checked.
const locatorCaseId = latestExecId.value;
const hasLocatorPanel = computed(() => Boolean(clusterVerdict.value?.isLocatorResolutionFailure && locatorCaseId));

// The page fetches the healing once and hands it to the panel, so the Locator fix
// section appears only when there is something to show, and never when healing
// is hidden for this project. When the next step replaces the locator, the page
// waits for the healing, so the section and its panel are in the first render.
const healingLeads = nextStep.value?.kind === 'replace-locator';
const { data: clusterLocatorHealing } = await useFetch<LocatorHealingResult>(
  () => `/api/test-run-cases/${locatorCaseId}/locator-healing`,
  {
    lazy: !healingLeads,
    immediate: Boolean(locatorCaseId) && (hasLocatorPanel.value || healingLeads),
    key: `locator-healing-${locatorCaseId}`,
  },
);
const clusterLocatorHasData = computed(() => {
  const h = clusterLocatorHealing.value;
  return (
    !!h &&
    h.source !== 'none' &&
    !!(h.fromElementMatch?.length || h.fromPriorSuccess?.length || h.fromAriaSnapshot?.length)
  );
});
const {
  state: clusterCapState,
  isHidden: clusterCapHidden,
  canDecide: canDecideClusterCap,
  decide: decideClusterProjectCap,
} = await useProjectCapabilities(cluster.value?.project?.id ?? 0);
const { decide: decideClusterInstanceCap } = await useInstanceCapabilities();

async function declineClusterFixtures(level: 'project' | 'instance') {
  if (level === 'project') await decideClusterProjectCap('fixtures', 'declined');
  else await decideClusterInstanceCap('fixtures', 'declined');
}
const showLocatorFix = computed(
  () => hasLocatorPanel.value && clusterLocatorHasData.value && !clusterCapHidden('locator-healing'),
);
const showVerify = computed(() => Boolean(fixPlan.value?.verify?.command));
const showReproduce = computed(() => Boolean(fixPlan.value?.reproduce?.steps?.length));
const fixedBefore = computed(() => fixPlan.value?.fixedBefore ?? []);
const fixSections = computed<FixSectionKey[]>(() => {
  const s: FixSectionKey[] = ['diagnosis'];
  if (fixedBefore.value.length) s.push('fixed-before');
  if (showLocatorFix.value) s.push('locator-fix');
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

// The diagnosis panel exposes its context and re-diagnose actions for the page's
// More menu and next step.
interface DiagnosisPanelActions {
  openContext: () => void;
  openHistory: () => void;
  reDiagnose?: () => void;
}
const diagnosisPanel = ref<DiagnosisPanelActions | null>(null);
const { aiStatus } = useAiStatus();

// The prompt a diagnosis would send, copied by the More menu and the next step.
const diagnosisContextEndpoint = `/api/failure-clusters/${clusterId}/context`;
const { copyPrompt: copyAiPrompt } = useCopyAiPrompt();

const { copy: copyMarkdown, copied: markdownCopied } = useCopy();
function copyFixPlanMarkdown() {
  if (!fixPlan.value) return;
  const url = typeof window !== 'undefined' ? window.location.href : undefined;
  copyMarkdown(fixPlanToMarkdown(fixPlan.value, { url }), { toast: 'Fix plan copied as Markdown' });
}

// ── Bulk actions (More menu) ─────────────────────────────────────────────────
const quarantineAll = ref<{ trigger: () => void } | null>(null);
const pendingQuarantine = computed(() => affectedCases.value.filter((c) => !c.quarantined));

// Grouped as on the execution page: the ticket, the test actions, the copies,
// then Refresh.
const moreMenuItems = computed<DropdownMenuItem[][]>(() => {
  // The ticket first: open it, or file or link one, from any scroll depth.
  const issue: DropdownMenuItem[] = [];
  if (knownIssue.value) {
    issue.push({
      label: `Open ${knownIssue.value.key}`,
      icon: getProviderIcon(knownIssue.value.provider as LinkProvider),
      to: safeHttpUrl(knownIssue.value.url) ?? undefined,
      target: '_blank',
    });
  } else if (canFileIssue.value && cluster.value?.issueFilingQueued) {
    issue.push({
      label: 'Filing queued · Retry',
      icon: 'i-lucide-clock',
      onSelect: () => (issueModalOpen.value = true),
    });
  } else if (canFileIssue.value) {
    issue.push({ label: 'Create issue', icon: 'i-lucide-file-plus', onSelect: () => (issueModalOpen.value = true) });
  }
  if (canLinkIssue.value) {
    issue.push({ label: 'Link an issue', icon: 'i-lucide-link', onSelect: () => (linkIssueOpen.value = true) });
  }

  const testActions: DropdownMenuItem[] = [];
  if (canQuarantine.value && pendingQuarantine.value.length > 0)
    testActions.push({
      label: 'Quarantine all affected tests',
      icon: 'i-lucide-shield-alert',
      color: 'warning',
      onSelect: () => quarantineAll.value?.trigger(),
    });
  if (canRerun.value && rerunInfo.value?.available)
    testActions.push({
      label: 'Re-run in CI',
      icon: 'i-lucide-refresh-cw',
      onSelect: () => void triggerRerun(),
    });

  const copies: DropdownMenuItem[] = [
    { label: 'Copy summary', icon: 'i-lucide-clipboard-list', onSelect: copyCluster },
  ];
  if (rerunInfo.value?.available && retryCommand.value)
    copies.push({
      label: 'Copy retry command',
      icon: 'i-lucide-clipboard',
      onSelect: () => copyRetry(retryCommand.value, { toast: 'Retry command copied' }),
    });
  if (aiStatus.value?.configured)
    copies.push({
      label: 'Show context',
      icon: 'i-lucide-eye',
      onSelect: () => void onDiagnosisPanel((panel) => panel.openContext()),
    });
  copies.push({
    label: 'Copy prompt',
    icon: 'i-lucide-clipboard-copy',
    onSelect: () => void copyAiPrompt(diagnosisContextEndpoint),
  });

  const refreshItem: DropdownMenuItem = { label: 'Refresh', icon: 'i-lucide-refresh-cw', onSelect: refresh };
  return [issue, testActions, copies, [refreshItem]].filter((group) => group.length > 0);
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
const toolbox = ref<{
  openSection: (k: FixSectionKey) => Promise<void>;
  scrollToSection: (k: FixSectionKey) => Promise<void>;
} | null>(null);

// The Diagnosis section renders its panel only while open: open it (and scroll to
// it with `scroll`), wait for the panel to mount, then act on it.
const toast = useToast();
async function onDiagnosisPanel(act: (panel: DiagnosisPanelActions) => void, scroll = false) {
  await (scroll ? toolbox.value?.scrollToSection('diagnosis') : toolbox.value?.openSection('diagnosis'));
  if (diagnosisPanel.value) act(diagnosisPanel.value);
  else
    toast.add({
      title: 'Diagnosis not available',
      description: 'This page has no Diagnosis section to act on.',
      color: 'error',
    });
}

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
  diagnosisContextEndpoint: () => diagnosisContextEndpoint,
  scrollToSection: (k) => toolbox.value?.scrollToSection(k),
  openSection: (k) => toolbox.value?.openSection(k),
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
  reDiagnose: () => onDiagnosisPanel((panel) => panel.reDiagnose?.(), true),
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
            :project-id="cluster.project?.id ?? null"
          />
          <ExportMenu
            v-if="cluster"
            :endpoint="`/api/failure-clusters/${cluster.id}/export`"
            :base-name="`piwi-cluster-${cluster.id}`"
          />
          <UDropdownMenu v-if="cluster" :items="moreMenuItems">
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
      </UDashboardNavbar>
    </template>

    <template #body>
      <div v-if="cluster" class="flex flex-col gap-4 p-4 max-sm:px-0 max-w-6xl mx-auto w-full">
        <!-- ── One block: identity, name, most likely, occurrences, what changed, state, next ── -->
        <SituationBlock help="cluster.state" :edge="stateEdge">
          <!-- Line 1: identity kicker — cluster #, error type, project, owner -->
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
            </div>
          </template>

          <!-- Line 2: the cluster name as the h1; the latest headline as a second line only when it adds value -->
          <template #headline>
            <h1 class="text-lg sm:text-xl font-semibold leading-snug text-highlighted break-words">
              <template v-for="(part, i) in clusterNameParts" :key="i">
                <LocatorCode v-if="part.kind === 'locator'" :locator="part.text" chip class="text-[0.92em]" />
                <template v-else>{{ part.text }}</template>
              </template>
            </h1>
            <p
              v-if="clusterVerdict && showSecondHeadline"
              data-shot="failure-headline"
              class="text-sm text-muted mt-1"
              :title="headlineTitle"
            >
              <FailureHeadline :parts="clusterVerdict.parts" chip />
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
            <ClusterStateLine
              :cluster="cluster"
              :state="clusterState"
              :action-in-next="!!clusterState.action && nextStep?.primary?.action === clusterState.action"
              @saved="refresh"
            />
          </template>

          <!-- Issue: the ticket the cluster is tracked in, or the way to file or link one -->
          <template v-if="issueForm" #issue>
            <IssueLine
              :form="issueForm"
              :project-id="clusterProjectId"
              :cluster-status="cluster.status"
              :failure-goes-on="cluster.failureGoesOn"
              :known-issue="knownIssue"
              :filing-failure="cluster.issueFilingFailure"
              @create="issueModalOpen = true"
              @link="linkIssueOpen = true"
            />
          </template>

          <!-- Line 5: the next step -->
          <template v-if="nextStep" #next>
            <NextStepLine :next-step="nextStep" :retry-command="retryCommand" @action="handleNextStepAction" />
          </template>

          <!-- Line 6: the facts line — Details, Raw error, Copy summary -->
          <template #facts>
            <ClusterFactsLine ref="factsLine" :cluster="cluster" :signature-line="signatureLine" @refresh="refresh" />
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
            :fixtures-state="clusterCapState('fixtures')"
            :can-decide-fixtures="canDecideClusterCap"
            help="case.evidence"
            @decline-fixtures="declineClusterFixtures"
          />
        </div>

        <!-- ── Occurrences over time, with the fix and a regression marked ── -->
        <ClusterOccurrenceTrend :cluster-id="cluster.id" />

        <!-- ── Fix attempts and what agents wrote to this cluster ──────── -->
        <ClusterActivity :cluster-id="cluster.id" />

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
                  :project-id="cluster.project?.id ?? null"
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
                :can-triage="canTriage"
                :applying-id="applyingId"
                @apply="applyTriage"
              />
            </template>

            <!-- Locator fix — the recommendation, its provenance and alternatives, once -->
            <template #locator-fix>
              <LocatorHealingPanel
                ref="clusterLocatorPanel"
                :test-runs-case-id="locatorCaseId!"
                :healing="clusterLocatorHealing ?? null"
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

  <!-- The ticket dialogs, opened from the Issue line and the More menu. -->
  <CreateIssueModal
    v-if="cluster && canFileIssue"
    v-model:open="issueModalOpen"
    entity-type="failure_cluster"
    :entity-id="cluster.id"
    :known-issue-key="knownIssue?.key ?? null"
    @created="onIssueChanged"
    @linked="onIssueChanged"
    @queued="onIssueChanged"
    @failed="refresh"
  />
  <LinkIssueModal
    v-if="cluster && canLinkIssue"
    v-model:open="linkIssueOpen"
    :cluster-id="cluster.id"
    :known-issue-key="knownIssue?.key ?? null"
    @linked="onIssueChanged"
  />

  <!-- Bulk actions triggered from the More menu. -->
  <QuarantineAllButton
    v-if="cluster && canQuarantine"
    ref="quarantineAll"
    hide-trigger
    :project-id="cluster.project?.id"
    :cases="cluster.affectedTestCases ?? []"
    :reason="`Quarantined from cluster #${cluster.id}`"
    @changed="refresh"
  />
</template>
