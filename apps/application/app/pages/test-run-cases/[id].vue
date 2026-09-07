<script setup lang="ts">
import type { AiStepIntent, AttemptOutcome, TestCaseHistoryPoint, TraceInfo } from '~~/types/api';
import { isPiwiAnnotation } from '@piwitests/core/test-meta';
import { renderAnsi } from '~/utils';
import { buildRetryCommand } from '~/utils/retry-command';
import type { FailureVerdict, FailureWhy } from '#shared/failure-verdict';
import type { FailureCluesResult } from '#shared/handlers/test-cases';
import { clusterSectionLocatorKey } from '~/composables/useClusterSectionLocator';
import { EVIDENCE_SECTION_TAB } from '~/utils/evidence-sections';
import type { FixSectionKey } from '~/components/shared/Toolbox.vue';
import type { BlockedCaseRef } from '~~/types/api';
import type { ReproRecipe, BisectResult, ReproduceDesktopContext } from '#shared/reproduce';
import type { FixedBeforeMatch, FixPlan } from '#shared/fix-plan.types';
import type { Situation, SituationPart } from '#shared/situation';
import type { NextStep } from '#shared/next-step';
import { commitUrl } from '#shared/scm-urls';
import { condenseErrorText } from '#shared/error-fingerprint';

const route = useRoute();
const testCaseId = route.params.id;

const { data: testCase, refresh } = await useFetch(`/api/test-run-cases/${testCaseId}`);

// The rows ride in the SSR payload, so the server and the client agree on the
// History block's strip at hydration.
const { data: historyData } = await useAsyncData(
  `test-run-case-history-${testCaseId}`,
  () => {
    const tcId = testCase.value?.testCaseId;
    return tcId
      ? $fetch<{ items: TestCaseHistoryPoint[] }>(`/api/test-cases/${tcId}/history`).then((r) => r.items)
      : Promise.resolve([]);
  },
  { default: (): TestCaseHistoryPoint[] => [], watch: [() => testCase.value?.testCaseId] },
);

// The deterministic clues and the story that chains them: the story line leads
// with the story (or the top clue), folds every clue under its disclosure, and
// the top clue's section chooses the default evidence tab.
const { data: cluesData } = await useFetch<FailureCluesResult>(`/api/test-run-cases/${testCaseId}/clues`, {
  default: (): FailureCluesResult => ({ clues: [], story: null, failureAt: null }),
});
const clues = computed(() => cluesData.value?.clues ?? []);
const story = computed(() => cluesData.value?.story ?? null);
const cluesFailureAt = computed(() => cluesData.value?.failureAt ?? null);
const topClue = computed(() => clues.value[0] ?? null);
const topClueSection = computed(() => topClue.value?.citations?.[0]?.section ?? null);

// The evidence opens on the story: the first member clue's cited section and the
// story's strength (or the top clue's, when no combination matched) tell the tab
// strip which view leads.
const defaultHint = computed<{ section: string | null; strength: 'strong' | 'medium' | 'weak' | null }>(() => {
  const s = story.value;
  if (s) {
    const first = clues.value.find((c) => c.id === s.clueIds[0]) ?? topClue.value;
    return { section: first?.citations?.[0]?.section ?? null, strength: s.strength };
  }
  return { section: topClueSection.value, strength: topClue.value?.strength ?? null };
});

const { data: traceData, refresh: refreshTraces } = await useFetch(`/api/test-run-cases/${testCaseId}/traces`, {
  transform: (r: { items: TraceInfo[] }) => r.items,
});

/** Whether a trace file exists for this execution — unlocks the "go deeper" evidence views. */
const hasTrace = computed(() => (traceData.value?.length ?? 0) > 0);

useHead(
  computed(() => ({
    title: testCase.value?.title
      ? `${testCase.value.title} — execution — Piwi Dashboard`
      : `Execution #${testCaseId} — Piwi Dashboard`,
  })),
);

const runIsActive = computed(() => {
  const status = testCase.value?.testRun?.status;
  return status === 'running' || status === 'finalizing';
});

const metadata = computed(() => testCase.value?.testRun?.metadata as Record<string, unknown> | null | undefined);
const scmInfo = computed(() => {
  const m = metadata.value;
  if (!m?.scm) return null;
  return m.scm as { commit?: string; branch?: string; author?: string; commitMessage?: string };
});
const ciInfo = computed(() => {
  const m = metadata.value;
  if (!m?.ci) return null;
  return m.ci as { provider?: string; buildNumber?: string; buildUrl?: string; workflow?: string; jobName?: string };
});
const environment = computed(() => testCase.value?.testRun?.environment);
const browser = computed(() => testCase.value?.browser ?? null);
const stepsCount = computed(() => (testCase.value?.steps as unknown[] | null)?.length ?? 0);

/** The one-line verdict on a failing execution, built server-side from the stored error and signals. */
const verdict = computed(() => (testCase.value as { verdict?: FailureVerdict | null } | null)?.verdict ?? null);

const failureCluster = computed(() => {
  return (testCase.value?.failureCluster ?? null) as {
    id: number;
    signature: string;
    title: string | null;
    selector: string | null;
    errorType: string | null;
    status: string | null;
    triageNote: string | null;
    occurrences: number;
    sameRunCaseCount: number;
    isNew: boolean;
    firstSeenRunId: number;
    firstSeenAt: string | null;
    diagnosis: {
      status?: string | null;
      category?: string | null;
      confidence?: string | null;
      summary?: string | null;
    } | null;
  } | null;
});

/** AI-step intent mappings from the execution's usage manifest (locator-fix probe). */
const aiIntents = computed<AiStepIntent[] | null>(() => {
  const usage = testCase.value?.aiUsage as unknown as { intents?: AiStepIntent[] } | null;
  return usage?.intents ?? null;
});

// ── Fix card ────────────────────────────────────────────────────────────────
/** Whether the desktop (Tauri) bridge is present — set on mount below. */
const desktopBridge = ref(false);

// The local reproduction recipe and generated bisect for this execution.
const { data: reproduceData } = await useFetch<{
  reproduce: ReproRecipe;
  bisect: BisectResult;
  desktop: ReproduceDesktopContext;
} | null>(`/api/test-run-cases/${testCaseId}/reproduce`);

/** The cluster's stored diagnosis, only when it completed and has a summary. */
const clusterDiagnosis = computed(() => {
  const d = failureCluster.value?.diagnosis;
  return d && d.status === 'completed' && d.summary ? d : null;
});
const confidenceColor = (c?: string | null): 'success' | 'warning' | 'neutral' =>
  c === 'high' ? 'success' : c === 'medium' ? 'warning' : 'neutral';

// The story is the one explanation on the first screen. A completed diagnosis
// leads the story line only when no deterministic story chained the clues — the
// story stays primary when it exists.
const storyDiagnosis = computed(() =>
  !story.value && clusterDiagnosis.value
    ? { summary: clusterDiagnosis.value.summary as string, confidence: clusterDiagnosis.value.confidence ?? null }
    : null,
);

// The situation sentence and the single next step, built server-side from the
// verdict and the same healing / diagnosis facts the toolbox reads.
const situation = computed(() => (testCase.value as { situation?: Situation | null } | null)?.situation ?? null);
const nextStep = computed(() => (testCase.value as { nextStep?: NextStep | null } | null)?.nextStep ?? null);

// The situation's leading why renders as the one exceptional badge; the rest as
// prose. A `commit` part links to the SCM host only when the run has a repository.
const WHY_BADGE: Record<FailureWhy, { label: string; color: 'error' | 'warning' | 'neutral' }> = {
  'new-regression': { label: 'New regression', color: 'error' },
  'passed-on-retry': { label: 'Passed on retry', color: 'warning' },
  'new-flaky': { label: 'Newly flaky', color: 'warning' },
  infrastructure: { label: 'Infrastructure failure', color: 'neutral' },
};
const leadWhy = computed<FailureWhy | null>(() => verdict.value?.why ?? null);
const repositoryUrl = computed(() => reproduceData.value?.desktop?.repositoryUrl ?? null);
function situationCommitHref(part: SituationPart): string | null {
  return part.id != null ? commitUrl(repositoryUrl.value, String(part.id)) : null;
}

// The story, situation and next lines are only for a problem execution; a passing
// one shows identity and facts alone.
const isProblem = computed(() => {
  const s = testCase.value?.status;
  return s === 'failed' || s === 'timedout' || s === 'timedOut' || s === 'didnotrun';
});

const blockedTests = computed(() => (testCase.value as { blockedTests?: BlockedCaseRef[] } | null)?.blockedTests ?? []);

/** A locator-resolution failure — the only case the Locator fix section applies to. */
const isLocatorFailure = computed(() =>
  Boolean(verdict.value?.isLocatorResolutionFailure && testCase.value?.testRun?.id),
);

// CI re-run for the cluster this failure belongs to, for the Verify section.
interface RerunInfo {
  available: boolean;
  reason: string | null;
  provider: string | null;
  enabled: boolean;
  hasToken: boolean;
  lastDispatch: { provider: string; url: string; args: string; at: number; byName: string | null } | null;
}
const { data: rerunInfo, refresh: refreshRerun } = await useAsyncData<RerunInfo | null>(
  `test-run-case-rerun-${testCaseId}`,
  () => {
    const id = failureCluster.value?.id;
    return id ? $fetch<RerunInfo>(`/api/failure-clusters/${id}/rerun`) : Promise.resolve(null);
  },
  { default: (): RerunInfo | null => null, watch: [() => failureCluster.value?.id] },
);
// "Fixed before" for the cluster this failure belongs to.
const { data: fixedBeforeData, refresh: refreshFixedBefore } = await useAsyncData<FixedBeforeMatch[]>(
  `test-run-case-fixed-before-${testCaseId}`,
  () => {
    const id = failureCluster.value?.id;
    return id
      ? $fetch<{ items: FixedBeforeMatch[] }>(`/api/failure-clusters/${id}/fixed-before`).then((r) => r.items)
      : Promise.resolve([]);
  },
  { default: (): FixedBeforeMatch[] => [], watch: [() => failureCluster.value?.id] },
);
const fixedBefore = computed(() => fixedBeforeData.value ?? []);

// The cluster's fix plan — its diagnosis patch backs the next step's copy /
// download / open-in-IDE actions, so it is fetched once here rather than by each
// action.
const { data: fixPlanData } = await useAsyncData<FixPlan | null>(
  `test-run-case-fix-plan-${testCaseId}`,
  () => {
    const id = failureCluster.value?.id;
    return id ? $fetch<FixPlan>(`/api/failure-clusters/${id}/fix-plan`).catch(() => null) : Promise.resolve(null);
  },
  { default: (): FixPlan | null => null, watch: [() => failureCluster.value?.id] },
);
const fixPlanPatch = computed(() => fixPlanData.value?.diagnosis?.patch ?? null);

const applyingId = ref<number | null>(null);
const applyToast = useToast();
async function applyTriage(match: FixedBeforeMatch) {
  const clusterId = failureCluster.value?.id;
  const currentStatus = failureCluster.value?.status;
  if (!clusterId || !currentStatus || applyingId.value != null) return;
  applyingId.value = match.clusterId;
  const excerpt = (match.triageNote ?? match.diagnosisTitle ?? match.reason).replace(/\s+/g, ' ').trim().slice(0, 280);
  const line = `Same as cluster #${match.clusterId}: ${excerpt}`;
  const existing = (failureCluster.value as { triageNote?: string | null } | null)?.triageNote?.trim();
  const triageNote = existing ? `${existing}\n${line}` : line;
  try {
    await $fetch(`/api/failure-clusters/${clusterId}/status`, {
      method: 'PATCH',
      body: { status: currentStatus, triageNote },
    });
    applyToast.add({ title: `Applied triage from cluster #${match.clusterId}`, color: 'success' });
    await Promise.all([refresh(), refreshFixedBefore()]);
  } catch {
    applyToast.add({ title: 'Could not apply the triage', color: 'error' });
  } finally {
    applyingId.value = null;
  }
}

const rerunToast = useToast();
const rerunning = ref(false);
async function triggerRerun() {
  const id = failureCluster.value?.id;
  if (!id || rerunning.value) return;
  rerunning.value = true;
  try {
    const res = await $fetch<{ ok: boolean; message?: string; dispatch?: { url: string } }>(
      `/api/failure-clusters/${id}/rerun`,
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
    const message = (e as { data?: { message?: string } })?.data?.message ?? 'Dispatch failed.';
    rerunToast.add({ title: 'CI re-run failed', description: message, color: 'error' });
  } finally {
    rerunning.value = false;
  }
}

/** The Verify section shows when a CI re-run is configured, or in the desktop shell. */
const showVerify = computed(() => Boolean(rerunInfo.value?.available) || desktopBridge.value);

/** Reproduce shows for a failing execution once its recipe is available. */
const showReproduce = computed(() => Boolean(verdict.value) && Boolean(reproduceData.value?.reproduce?.steps?.length));

/** The Fix card's sections, in the order the card renders them. */
const fixSections = computed<FixSectionKey[]>(() => {
  const s: FixSectionKey[] = [];
  if (isLocatorFailure.value) s.push('locator-fix');
  if (failureCluster.value) s.push('fix-plan');
  s.push('diagnosis');
  if (fixedBefore.value.length) s.push('fixed-before');
  if (showVerify.value) s.push('verify');
  if (showReproduce.value) s.push('reproduce');
  if (blockedTests.value.length) s.push('blocked');
  return s;
});

// The Fix card covers a failing execution (something to fix) or one that blocked others.
const showFix = computed(() => Boolean(verdict.value) || blockedTests.value.length > 0);

// ── Folded one-line summaries for the toolbox sections ───────────────────────
const { aiStatus } = useAiStatus();
const diagnosisSummary = computed(() => {
  const d = failureCluster.value?.diagnosis;
  if (d?.status === 'completed' && (clusterDiagnosis.value || d.category)) {
    const title = clusterDiagnosis.value?.summary ?? d.category ?? 'Diagnosed';
    return d.confidence ? `${title} · ${d.confidence} confidence` : title;
  }
  return aiStatus.value?.configured === false ? 'AI is not configured' : 'Not diagnosed yet';
});
const reproduceSummary = computed(() => {
  const steps = reproduceData.value?.reproduce?.steps?.length ?? 0;
  const bisect = reproduceData.value?.bisect?.available ? 'bisect available' : 'bisect not available';
  return `${steps} commands · Linux/macOS or Windows · ${bisect}`;
});
const verifySummary = computed(() => {
  const cmd = retryCommand.value ?? '';
  const g = cmd.match(/-g\s+(".*?"|'.*?'|\S+)/)?.[1];
  const parts = [g ? `-g ${g}` : 'Re-run the failing test'];
  if (rerunInfo.value?.available) parts.push('Re-run in CI');
  return parts.join(' · ');
});

const historicalTiming = computed(() => {
  if (!historyData.value || historyData.value.length < 2 || !testCase.value?.duration) return null;
  const previous = historyData.value.filter((h) => h.duration !== null && h.id !== testCase.value?.id);
  if (previous.length === 0) return null;
  const avg = previous.reduce((sum, h) => sum + (h.duration || 0), 0) / previous.length;
  const current = testCase.value.duration;
  const diff = current - avg;
  const pct = avg > 0 ? Math.round((diff / avg) * 100) : 0;
  return { avg: Math.round(avg), current, diff: Math.round(diff), pct };
});

// ── Header: identity, exceptional badges, facts ─────────────────────────────
// The first captured source frame — the failing line — beats the test()
// declaration for the header's "open in IDE" link.
const ideTarget = computed(() => {
  const frames = (testCase.value as { testSourceFrames?: Array<{ filePath?: string; line?: number }> | null } | null)
    ?.testSourceFrames;
  const frame = frames?.[0];
  if (!frame?.filePath) return null;
  return { filePath: frame.filePath, line: frame.line };
});

// Playwright test marks only — `piwi:` annotations are ownership, not marks.
const annotations = computed(() =>
  (testCase.value?.testAnnotations ?? []).filter(
    (ann: { type: string; description?: string | null }) => !isPiwiAnnotation(ann.type),
  ),
);

const quarantined = computed(() => Boolean((testCase.value as { quarantined?: boolean } | null)?.quarantined));

/**
 * Exceptional badges only. The why-signals (regression, passed on retry, newly
 * flaky) live in the headline's fact row when there is a headline, so they show
 * in the header only for an execution with no headline (a passing or
 * passed-on-retry attempt) — a fact appears once. Playwright marks always show.
 */
const headerBadges = computed(() => {
  const tc = testCase.value;
  type Badge = {
    label: string;
    color?: 'error' | 'warning' | 'neutral';
    icon?: string;
    title?: string;
    mono?: boolean;
  };
  if (!tc) return [] as Badge[];
  const out: Badge[] = [];
  if (!verdict.value) {
    if (tc.isNewRegression)
      out.push({
        label: 'New regression',
        color: 'error',
        icon: 'i-lucide-git-pull-request-arrow',
        title: 'Passed in the baseline run, failing here',
      });
    if (tc.status === 'passed' && (tc.retries ?? 0) > 0)
      out.push({
        label: 'Passed on retry',
        color: 'warning',
        icon: 'i-lucide-refresh-cw',
        title: 'This test failed then passed on a retry',
      });
    if (tc.isNewFlaky)
      out.push({
        label: 'Newly flaky',
        color: 'warning',
        icon: 'i-lucide-shuffle',
        title: 'Newly started passing only on retry',
      });
  }
  for (const ann of annotations.value)
    out.push({ label: `@${ann.type}`, color: 'neutral', mono: true, title: ann.description || ann.type });
  return out;
});

// ── Attempts (facts line) ───────────────────────────────────────────────────
const attempts = computed(() => testCase.value?.attempts ?? null);
function attemptColor(status: string): 'success' | 'error' | 'neutral' {
  if (status === 'passed') return 'success';
  if (status === 'failed' || status === 'timedout' || status === 'timedOut') return 'error';
  return 'neutral';
}
function attemptTitle(a: AttemptOutcome): string {
  const when = a.startedAt ? ` at ${new Date(a.startedAt).toLocaleString()}` : '';
  return `Attempt ${a.retry + 1}: ${a.status} (${Math.round(a.duration)} ms)${when}`;
}
function isCurrentAttempt(a: AttemptOutcome): boolean {
  return a.retry === (testCase.value?.retries ?? 0);
}
function attemptLink(a: AttemptOutcome): string | null {
  return !isCurrentAttempt(a) && a.executionId ? `/test-run-cases/${a.executionId}` : null;
}

// ── Retry command ────────────────────────────────────────────────────────────
// The trailing "then" on the next-step line, plus the More menu and the Verify
// section — no longer an always-on header button.
const retryCases = computed(() => [
  {
    filePath: testCase.value?.filePath ?? '',
    title: testCase.value?.title ?? '',
    line: testCase.value?.line ?? null,
    projectName: (testCase.value?.browser as { projectName?: string } | null)?.projectName ?? null,
  },
]);
const retryCommand = computed(() => buildRetryCommand(retryCases.value));
const { copy: copyRetry } = useCopy();

onMounted(() => {
  desktopBridge.value = !!tauriCore();
});

// ── Quarantine ──────────────────────────────────────────────────────────────
const { canWrite } = useAuth();
const { quarantineOne, releaseOne } = useQuarantine(() => testCase.value?.testRun?.project?.id ?? null);
const quarantineBusy = ref(false);
async function toggleQuarantine() {
  const stableId = testCase.value?.testCaseId;
  if (!stableId || quarantineBusy.value) return;
  quarantineBusy.value = true;
  try {
    const ok = quarantined.value
      ? await releaseOne(stableId)
      : await quarantineOne(stableId, 'Quarantined from execution');
    if (ok) await refresh();
  } finally {
    quarantineBusy.value = false;
  }
}

// ── Copy failure ────────────────────────────────────────────────────────────
const { copyRich } = useCopyRich();
function copyFailure() {
  const tc = testCase.value;
  if (!tc?.error) return;
  const origin = window.location.origin;
  const title = tc.title ?? 'Unknown test';
  const loc = tc.location ?? '';
  // eslint-disable-next-line no-control-regex
  const rawError = tc.error.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '');
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const clusterUrl = failureCluster.value ? `${origin}/failure-clusters/${failureCluster.value.id}` : null;
  const testCaseUrl = `${origin}/test-run-cases/${testCaseId}`;
  const stableUrl = testCase.value?.testCaseId ? `${origin}/test-cases/${testCase.value.testCaseId}` : null;

  const plain = [
    `❌ Test failed: ${title}`,
    loc ? `Location: ${loc}` : null,
    '',
    'Error:',
    rawError,
    '',
    clusterUrl ? `Failure cluster: ${clusterUrl}` : null,
    `Execution: ${testCaseUrl}`,
    stableUrl ? `History: ${stableUrl}` : null,
  ]
    .filter((l) => l !== null)
    .join('\n');

  const html = [
    `<p><strong>❌ Test failed: ${esc(title)}</strong>${loc ? `<br><code>${esc(loc)}</code>` : ''}</p>`,
    `<p><strong>Error:</strong></p><pre>${renderAnsi(tc.error)}</pre>`,
    `<p>🔗 ${clusterUrl ? `<a href="${clusterUrl}">View failure cluster</a> · ` : ''}<a href="${testCaseUrl}">Execution details</a>${stableUrl ? ` · <a href="${stableUrl}">Test history</a>` : ''}</p>`,
  ].join('');

  copyRich(plain, html, { toast: 'Failure copied' });
}

// ── Link an issue ─────────────────────────────────────────────────────────
const linksModalOpen = ref(false);

// ── Navbar More menu ────────────────────────────────────────────────────────
const moreMenuItems = computed(() => {
  const items: { label: string; icon: string; color?: 'warning'; onSelect: () => void }[] = [];
  // The retry command was the header's always-on primary; it now lives here and
  // on the next-step line (for code-change steps) and in the Verify section.
  if (retryCommand.value && !desktopBridge.value) {
    items.push({
      label: 'Copy retry command',
      icon: 'i-lucide-clipboard',
      onSelect: () => copyRetry(retryCommand.value, { toast: 'Retry command copied' }),
    });
  }
  if (canWrite.value && testCase.value?.testCaseId) {
    items.push(
      quarantined.value
        ? {
            label: 'Release from quarantine',
            icon: 'i-lucide-shield-check',
            color: 'warning',
            onSelect: toggleQuarantine,
          }
        : {
            label: 'Quarantine this test',
            icon: 'i-lucide-shield-alert',
            color: 'warning',
            onSelect: toggleQuarantine,
          },
    );
  }
  items.push({ label: 'Link an issue', icon: 'i-lucide-link', onSelect: () => (linksModalOpen.value = true) });
  if (testCase.value?.error) items.push({ label: 'Copy failure', icon: 'i-lucide-clipboard', onSelect: copyFailure });
  items.push({ label: 'Refresh', icon: 'i-lucide-refresh-cw', onSelect: () => refresh() });
  return items;
});

// ── Live streaming ──────────────────────────────────────────────────────────
const isDemoMode = Boolean(useRuntimeConfig().public.demoMode);
let eventSource: EventSource | null = null;
function connectToRunStream() {
  if (!import.meta.client || isDemoMode || eventSource) return;
  const runId = testCase.value?.testRun?.id;
  if (!runId) return;
  eventSource = new EventSource(`/api/test-runs/${runId}/stream`);
  eventSource.onmessage = (event) => {
    try {
      const parsed = JSON.parse(event.data);
      if (parsed.type === 'case-files' && parsed.data?.executionId === Number(testCaseId)) {
        refresh();
        refreshTraces();
      } else if (parsed.type === 'run-finished') {
        refresh();
        refreshTraces();
        disconnectRunStream();
      }
    } catch {
      // Ignore non-JSON messages (e.g. heartbeat comments)
    }
  };
  eventSource.onerror = () => {
    // EventSource will auto-reconnect
  };
}
function disconnectRunStream() {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}
watch(
  runIsActive,
  (active) => {
    if (active) connectToRunStream();
    else disconnectRunStream();
  },
  { immediate: true },
);
onUnmounted(disconnectRunStream);

// ── Section locator ─────────────────────────────────────────────────────────
// A clue or diagnosis citation reveals the evidence it came from: the evidence
// tabs handle the tabbed sections (switch tab + scroll), while the raw error and
// locator-fix blocks scroll in place.
const rawErrorOpen = ref(false);
const rawErrorEl = ref<HTMLElement | null>(null);
const fixCardEl = ref<HTMLElement | null>(null);
const evidenceEl = ref<HTMLElement | null>(null);
const locatorPanel = ref<{
  copyPatch: () => void;
  copyRecommendedLocator: () => void;
  openPicker: () => void;
  expandAlternatives: () => void;
} | null>(null);
const evidenceTabs = ref<{
  canLocate: (id: string) => boolean;
  revealSection: (id: string) => boolean;
  selectTab: (t: string) => void;
} | null>(null);

function scrollToEl(el: HTMLElement | null) {
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// The raw error is a disclosure on the facts line; the locator fix lives in the
// Fix card. A citation reveals or scrolls to the block that holds it.
function revealRawError() {
  rawErrorOpen.value = true;
  nextTick(() => scrollToEl(rawErrorEl.value));
}
const pageSections: Record<string, () => void> = {
  sampleError: revealRawError,
  executionError: revealRawError,
  locatorHealing: () => scrollToFixSection('locator-fix'),
};
provide(clusterSectionLocatorKey, {
  // Answered from static maps so a citation renders as a button at SSR time too,
  // not only once the evidence card has mounted and registered its ref.
  canLocate: (id: string) => id in pageSections || id in EVIDENCE_SECTION_TAB,
  open: (id: string) => {
    if (id in pageSections) pageSections[id]!();
    else evidenceTabs.value?.revealSection(id);
  },
});

// ── Next step: turn one action id into the real behaviour ────────────────────
// The next-step line stays presentation-only; the page owns the wiring through
// the shared composable, reusing the same fetches and panels the toolbox does
// rather than issuing new requests. Page-specific targets are callbacks.
const triageToast = useToast();

/** Open a toolbox section and scroll to it (its body is otherwise folded away). */
const toolbox = ref<{ openSection: (k: string) => void } | null>(null);
function scrollToFixSection(key: 'diagnosis' | 'reproduce' | 'locator-fix') {
  toolbox.value?.openSection(key);
  nextTick(() => {
    const el = import.meta.client ? document.querySelector<HTMLElement>(`[data-shot="fix-${key}"]`) : null;
    scrollToEl(el ?? fixCardEl.value);
  });
}

async function setClusterStatus(status: 'open' | 'resolved') {
  const id = failureCluster.value?.id;
  if (!id) return;
  try {
    await $fetch(`/api/failure-clusters/${id}/status`, { method: 'PATCH', body: { status } });
    triageToast.add({
      title: status === 'resolved' ? 'Cluster marked resolved' : 'Cluster reopened',
      color: 'success',
    });
    await refresh();
  } catch {
    triageToast.add({ title: 'Could not update the cluster', color: 'error' });
  }
}

const { handle: handleNextStepAction } = useNextStepActions({
  clusterId: () => failureCluster.value?.id ?? null,
  fixPlanPatch: () => fixPlanPatch.value,
  ideProject: () => testCase.value?.testRun?.project ?? null,
  locatorPanel: () => locatorPanel.value,
  reproRecipe: () => reproduceData.value?.reproduce ?? null,
  diagnosisContextEndpoint: () => `/api/test-run-cases/${testCaseId}/diagnosis-context`,
  scrollToDiagnosis: () => scrollToFixSection('diagnosis'),
  scrollToReproduce: () => scrollToFixSection('reproduce'),
  scrollToLocatorFix: () => scrollToFixSection('locator-fix'),
  selectAttemptsTab: () => {
    evidenceTabs.value?.selectTab('attempts');
    nextTick(() => scrollToEl(evidenceEl.value));
  },
  setClusterStatus,
  quarantine: () => toggleQuarantine(),
  rerunInCi: () => triggerRerun(),
  openExecution: (id) => {
    navigateTo(`/test-run-cases/${id}`);
  },
  whatChanged: () => {
    if (failureCluster.value) navigateTo(`/failure-clusters/${failureCluster.value.id}`);
  },
  reDiagnose: () => {
    if (failureCluster.value) navigateTo(`/failure-clusters/${failureCluster.value.id}#fix-plan`);
  },
});
</script>

<template>
  <UDashboardPanel id="test-run-case-detail">
    <template #header>
      <!-- The breadcrumb's current crumb is the page title; a navbar title would repeat it. -->
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <BreadcrumbNav
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              ...(testCase?.testRun?.project?.id
                ? [
                    {
                      label: testCase.testRun.project.name || 'Project',
                      to: `/projects/${testCase.testRun.project.id}`,
                    },
                  ]
                : [{ label: 'Project' }]),
              ...(testCase?.testRun?.id
                ? [{ label: `Run #${testCase.testRun.id}`, to: `/test-runs/${testCase.testRun.id}` }]
                : [{ label: 'Test run' }]),
              { label: testCase?.title || `Execution #${testCaseId}` },
            ]"
          />
        </template>
        <template #right>
          <div class="flex items-center gap-1 shrink-0 min-w-0">
            <NuxtLink
              v-if="testCase?.testCaseId"
              :to="`/test-cases/${testCase.testCaseId}`"
              class="text-xs text-gray-500 hover:text-primary mr-2 flex items-center gap-1 shrink-0"
              title="View this test's history across runs"
              aria-label="Test history"
            >
              <UIcon name="i-lucide-trending-up" class="size-3.5" />
              <span class="hidden xl:inline">Test history</span>
            </NuxtLink>
            <ShareLinksModal
              v-if="testCase && !isDemoMode"
              :endpoint="`/api/test-run-cases/${testCase.id}/share-links`"
            />
            <ExportMenu
              v-if="testCase"
              :endpoint="`/api/test-run-cases/${testCase.id}/export`"
              :perfetto-endpoint="`/api/test-run-cases/${testCase.id}/perfetto`"
              :base-name="`piwi-execution-${testCase.id}`"
              class="mr-1"
            />
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
          </div>
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <!-- No side gutter below `sm`: the cards go full-bleed to the screen edge. -->
      <div class="flex flex-col gap-4 p-4 max-sm:px-0 max-w-6xl mx-auto w-full">
        <!-- ── One block: what broke, what is going on, what to do next ── -->
        <SituationBlock help="case.situation">
          <!-- Line 1: identity kicker — status, title, marks, quarantine -->
          <template #identity>
            <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
              <StatusChip :status="testCase?.status ?? ''" class="shrink-0" />
              <span class="font-medium text-highlighted min-w-0 break-words">
                {{ testCase?.title || `Execution #${testCaseId}` }}
              </span>
              <template v-for="badge in headerBadges" :key="badge.label">
                <UBadge
                  :color="badge.color ?? 'neutral'"
                  variant="subtle"
                  size="xs"
                  :title="badge.title"
                  :class="['inline-flex items-center gap-1', badge.mono ? 'font-mono' : '']"
                >
                  <UIcon v-if="badge.icon" :name="badge.icon" class="size-3 shrink-0" />
                  {{ badge.label }}
                </UBadge>
              </template>
              <QuarantinedChip v-if="quarantined" />
            </div>
          </template>

          <!-- Line 2: the headline — the page's h1 -->
          <template v-if="verdict" #headline>
            <h1
              data-shot="failure-headline"
              class="text-lg sm:text-xl font-semibold leading-snug text-highlighted break-words"
            >
              <FailureHeadline :parts="verdict.parts" />
            </h1>
            <p
              v-if="verdict.detail && !story"
              class="font-mono text-xs text-muted truncate mt-1"
              :title="verdict.detail"
            >
              {{ verdict.detail }}
            </p>
          </template>

          <!-- Line 3: most likely — the story line, with every clue folded under it -->
          <template v-if="verdict && (story || clues.length)" #story>
            <StoryLine :story="story" :clues="clues" :failure-at="cluesFailureAt" :diagnosis="storyDiagnosis" />
          </template>

          <!-- Line 4: the situation sentence — one clause per fact, with links -->
          <template v-if="situation" #situation>
            <p data-shot="situation" class="text-sm text-toned leading-relaxed">
              <template v-for="(part, i) in situation.parts" :key="i">
                <template v-if="i === 0 && leadWhy">
                  <UBadge :color="WHY_BADGE[leadWhy].color" variant="subtle" size="sm" class="mr-0.5 align-middle">
                    {{ WHY_BADGE[leadWhy].label }}
                  </UBadge>
                  <span>{{ part.text.slice(WHY_BADGE[leadWhy].label.length) }}</span>
                </template>
                <NuxtLink
                  v-else-if="part.href"
                  :to="part.href"
                  class="text-primary hover:underline"
                  :class="part.kind === 'commit' ? 'font-mono' : ''"
                  >{{ part.text }}</NuxtLink
                >
                <a
                  v-else-if="part.kind === 'commit' && situationCommitHref(part)"
                  :href="situationCommitHref(part)!"
                  target="_blank"
                  rel="noopener"
                  class="text-primary hover:underline font-mono"
                  >{{ part.text }}</a
                >
                <span v-else-if="part.kind === 'commit'" class="font-mono">{{ part.text }}</span>
                <span v-else-if="part.kind === 'owner'" class="text-highlighted">{{ part.text }}</span>
                <template v-else>{{ part.text }}</template>
              </template>
            </p>
          </template>

          <!-- Line 5: the next step -->
          <template v-if="isProblem && nextStep" #next>
            <NextStepLine :next-step="nextStep" :retry-command="retryCommand" @action="handleNextStepAction" />
          </template>

          <!-- Line 6: the facts line, one size smaller, with Details and Raw error -->
          <template #facts>
            <div class="flex items-center gap-x-2 gap-y-1 flex-wrap text-xs text-muted">
              <OpenInIdeLink
                v-if="ideTarget?.filePath || testCase?.location"
                :file-path="ideTarget?.filePath"
                :line="ideTarget?.line"
                :location="ideTarget ? undefined : (testCase?.location ?? undefined)"
                :project-key="testCase?.testRun?.project?.id"
                :project-name="testCase?.testRun?.project?.name"
              />
              <!-- Secondary facts collapse at 390px; they stay in Details below. -->
              <span class="max-sm:hidden inline-flex items-center gap-x-2 gap-y-1 flex-wrap">
                <span v-if="browser" class="inline-flex items-center gap-1">
                  <BrowserBadge :browser="{ ...browser, viewport: undefined }" size="sm" />
                  <span v-if="browser.viewport" class="tabular-nums">
                    {{ browser.viewport.width }}×{{ browser.viewport.height }}
                  </span>
                </span>
                <span v-if="testCase?.status !== 'didnotrun'" class="inline-flex items-center gap-1 tabular-nums">
                  <DurationValue :ms="testCase?.duration" class="font-medium text-toned" />
                  <span v-if="historicalTiming" class="text-dimmed">
                    (avg <DurationValue :ms="historicalTiming.avg" />,
                    <span :class="historicalTiming.diff > 0 ? 'text-red-600' : 'text-green-600'">
                      {{ historicalTiming.diff > 0 ? '+' : '' }}{{ historicalTiming.pct }}%</span
                    >)
                  </span>
                </span>
                <span
                  v-if="attempts && attempts.length > 1"
                  class="inline-flex items-center gap-1"
                  role="group"
                  aria-label="Attempts of this test in this run"
                >
                  <template v-for="a in attempts" :key="a.retry">
                    <NuxtLink
                      v-if="attemptLink(a)"
                      :to="attemptLink(a)!"
                      :title="`${attemptTitle(a)} — open this attempt`"
                      class="inline-flex rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-primary hover:opacity-80"
                    >
                      <UBadge :color="attemptColor(a.status)" variant="soft" size="sm" class="font-mono">
                        {{ a.retry + 1 }}/{{ attempts.length }}
                        <UIcon :name="a.status === 'passed' ? 'i-lucide-check' : 'i-lucide-x'" class="w-3 h-3" />
                      </UBadge>
                    </NuxtLink>
                    <UBadge
                      v-else
                      :color="attemptColor(a.status)"
                      variant="soft"
                      size="sm"
                      class="font-mono"
                      :class="isCurrentAttempt(a) ? 'ring-2 ring-offset-1 ring-primary' : ''"
                      :title="isCurrentAttempt(a) ? `${attemptTitle(a)} — this execution` : attemptTitle(a)"
                      :aria-current="isCurrentAttempt(a) ? 'true' : undefined"
                    >
                      {{ a.retry + 1 }}/{{ attempts.length }}
                      <UIcon :name="a.status === 'passed' ? 'i-lucide-check' : 'i-lucide-x'" class="w-3 h-3" />
                    </UBadge>
                  </template>
                </span>
                <span v-if="scmInfo?.branch" class="inline-flex items-center gap-1">
                  <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0" />
                  <span class="font-medium">{{ scmInfo.branch }}</span>
                </span>
                <a
                  v-if="ciInfo?.buildUrl || ciInfo?.buildNumber"
                  :href="ciInfo?.buildUrl || undefined"
                  :target="ciInfo?.buildUrl ? '_blank' : undefined"
                  :class="
                    ciInfo?.buildUrl
                      ? 'text-primary hover:underline inline-flex items-center gap-1'
                      : 'inline-flex items-center gap-1'
                  "
                >
                  <UIcon name="i-lucide-cloud" class="size-3.5 shrink-0" />
                  {{ ciInfo?.buildNumber ? `Build #${ciInfo.buildNumber}` : 'View build' }}
                </a>
                <ClientOnly>
                  <span
                    v-if="testCase?.startedAt"
                    class="text-dimmed"
                    :title="new Date(testCase.startedAt).toLocaleString()"
                  >
                    {{ formatRelativeTime(testCase.startedAt) }}
                  </span>
                </ClientOnly>
              </span>

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
                  <div class="p-3 space-y-2 text-sm max-w-sm">
                    <!-- The facts that collapse on mobile, kept reachable here. -->
                    <div class="space-y-1 sm:hidden">
                      <p class="text-xs font-medium text-muted uppercase tracking-wide">Run</p>
                      <p v-if="testCase?.status !== 'didnotrun'" class="tabular-nums">
                        Duration: <DurationValue :ms="testCase?.duration" />
                      </p>
                      <p v-if="scmInfo?.branch">
                        Branch: <span class="text-highlighted">{{ scmInfo.branch }}</span>
                      </p>
                      <p v-if="ciInfo?.buildNumber">Build #{{ ciInfo.buildNumber }}</p>
                      <ClientOnly>
                        <p v-if="testCase?.startedAt">{{ formatRelativeTime(testCase.startedAt) }}</p>
                      </ClientOnly>
                    </div>
                    <div v-if="environment || ciInfo" class="space-y-1">
                      <p class="text-xs font-medium text-muted uppercase tracking-wide">CI &amp; environment</p>
                      <p v-if="environment">
                        Environment: <span class="text-highlighted">{{ environment }}</span>
                      </p>
                      <p v-if="ciInfo?.provider">Provider: {{ ciInfo.provider }}</p>
                      <p v-if="ciInfo?.workflow || ciInfo?.jobName">
                        <template v-if="ciInfo?.workflow">{{ ciInfo.workflow }}</template>
                        <template v-if="ciInfo?.workflow && ciInfo?.jobName"> · </template>
                        <template v-if="ciInfo?.jobName">{{ ciInfo.jobName }}</template>
                      </p>
                    </div>
                    <div
                      v-if="testCase?.testRun?.playwrightVersion || testCase?.testRun?.reporterVersion"
                      class="space-y-1"
                    >
                      <p class="text-xs font-medium text-muted uppercase tracking-wide">Tooling</p>
                      <p>
                        <template v-if="testCase?.testRun?.playwrightVersion"
                          >Playwright v{{ testCase.testRun.playwrightVersion }}</template
                        >
                        <template v-if="testCase?.testRun?.playwrightVersion && testCase?.testRun?.reporterVersion">
                          ·
                        </template>
                        <template v-if="testCase?.testRun?.reporterVersion"
                          >Piwi v{{ testCase.testRun.reporterVersion }}</template
                        >
                      </p>
                    </div>
                    <div class="space-y-1">
                      <p class="text-xs font-medium text-muted uppercase tracking-wide">Execution</p>
                      <p class="tabular-nums">
                        Worker {{ testCase?.workerIndex ?? '—'
                        }}<template v-if="testCase?.shardIndex != null"> · Shard {{ testCase.shardIndex }}</template> ·
                        {{ stepsCount }} steps
                      </p>
                      <p
                        v-if="testCase?.slowestStep && testCase?.status !== 'didnotrun'"
                        class="truncate"
                        :title="testCase.slowestStep"
                      >
                        Slowest step: {{ testCase.slowestStep }}
                        <span v-if="testCase.slowestStepDuration"
                          >(<DurationValue :ms="testCase.slowestStepDuration" />)</span
                        >
                      </p>
                      <p v-if="(testCase?.wastedTimeMs ?? 0) > 0">
                        Wasted in fixed waits: <DurationValue :ms="testCase?.wastedTimeMs" />
                      </p>
                    </div>
                    <div v-if="testCase?.locks?.length" class="space-y-1">
                      <p class="text-xs font-medium text-muted uppercase tracking-wide">Locks</p>
                      <p class="flex flex-wrap items-center gap-1.5">
                        <span
                          v-for="lock in testCase.locks"
                          :key="lock"
                          class="inline-flex items-center gap-1 text-highlighted"
                          title="Only one holder of this lock runs at a time"
                        >
                          <UIcon name="i-lucide-lock" class="size-3 text-warning" />{{ lock }}
                        </span>
                      </p>
                    </div>
                    <div v-if="testCase?.tags?.length || testCase?.testMeta" class="space-y-1">
                      <p class="text-xs font-medium text-muted uppercase tracking-wide">Tags</p>
                      <TestMetaBadges :tags="testCase?.tags" :meta="testCase?.testMeta" />
                    </div>
                    <div v-if="testCase?.executionId" class="space-y-1">
                      <p class="text-xs font-medium text-muted uppercase tracking-wide">Links</p>
                      <EntityLinks
                        entity-type="test_case"
                        :entity-id="testCase.executionId"
                        :links="(testCase as any)?.stableLinks ?? null"
                        readonly
                      />
                    </div>
                  </div>
                </template>
              </UPopover>

              <!-- Raw error: the verbatim ANSI output, one click below the block. -->
              <button
                v-if="testCase?.error"
                type="button"
                class="inline-flex items-center gap-1 text-primary hover:underline shrink-0"
                :aria-expanded="rawErrorOpen"
                @click="rawErrorOpen = !rawErrorOpen"
              >
                <UIcon :name="rawErrorOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'" class="size-3.5" />
                Raw error
              </button>
            </div>

            <div v-if="rawErrorOpen && testCase?.error" ref="rawErrorEl" class="mt-2 space-y-1 scroll-mt-4">
              <div class="flex justify-end">
                <UButton
                  size="xs"
                  variant="ghost"
                  color="neutral"
                  icon="i-lucide-clipboard"
                  aria-label="Copy failure"
                  title="Copy failure"
                  @click="copyFailure"
                >
                  Copy failure
                </UButton>
              </div>
              <div
                class="text-xs font-mono whitespace-pre-wrap break-words max-h-96 overflow-y-auto rounded bg-red-50 dark:bg-red-950/20 p-3"
                v-html="renderAnsi(condenseErrorText(testCase.error))"
              />
            </div>
          </template>
        </SituationBlock>

        <!-- Why this execution never ran — pinned under the block for a did-not-run case. -->
        <DidNotRunCard
          :status="testCase?.status"
          :reason="(testCase as any)?.didNotRunReason ?? null"
          :blocked-by-case="(testCase as any)?.blockedByCase ?? null"
        />

        <!-- ── Evidence ───────────────────────────────────────────────── -->
        <div ref="evidenceEl" class="scroll-mt-4">
          <EvidenceTabs
            ref="evidenceTabs"
            :test-case="testCase"
            :traces="(traceData as TraceInfo[]) ?? []"
            :has-trace="hasTrace"
            :default-hint="defaultHint"
            help="case.evidence"
          />
        </div>

        <!-- ── More ways to fix ───────────────────────────────────────── -->
        <div ref="fixCardEl" class="scroll-mt-4">
          <Toolbox
            v-if="showFix"
            ref="toolbox"
            :sections="fixSections"
            :next-step-kind="nextStep?.kind ?? null"
            help="fix.toolbox"
          >
            <template #diagnosis-summary>{{ diagnosisSummary }}</template>
            <template #locator-fix-summary>Ranked replacement locators from the failing page</template>
            <template #verify-summary>{{ verifySummary }}</template>
            <template #reproduce-summary>{{ reproduceSummary }}</template>
            <template #fixed-before-summary
              >{{ fixedBefore.length }} similar resolved cluster{{ fixedBefore.length === 1 ? '' : 's' }}</template
            >
            <template #blocked-summary
              >{{ blockedTests.length }} test{{ blockedTests.length === 1 ? '' : 's' }}</template
            >
            <template #fix-plan-summary>The cluster's full fix plan — diagnosis, edits and verify command</template>

            <!-- Ranked replacement locators for a broken locator -->
            <template #locator-fix>
              <LocatorHealingPanel
                v-if="testCase?.testRun?.id"
                ref="locatorPanel"
                :run-id="testCase.testRun.id"
                :test-runs-case-id="Number(testCaseId)"
                :ai-intents="aiIntents"
                :chrome="false"
                :has-page-diff="true"
                @show-page-diff="evidenceTabs?.revealSection('pageDiff')"
              />
            </template>

            <!-- A pointer to the cluster's full fix plan -->
            <template v-if="failureCluster" #fix-plan>
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
                <template v-if="failureCluster.diagnosis?.status === 'completed'">
                  <UBadge v-if="failureCluster.diagnosis.category" color="neutral" variant="soft" size="xs">
                    {{ failureCluster.diagnosis.category }}
                  </UBadge>
                  <UBadge
                    v-if="failureCluster.diagnosis.confidence"
                    :color="confidenceColor(failureCluster.diagnosis.confidence)"
                    variant="soft"
                    size="xs"
                  >
                    {{ failureCluster.diagnosis.confidence }} confidence
                  </UBadge>
                </template>
                <span v-else class="text-muted">Assembled on the cluster page.</span>
                <UButton
                  :to="`/failure-clusters/${failureCluster.id}#fix-plan`"
                  size="xs"
                  color="neutral"
                  variant="link"
                  trailing-icon="i-lucide-arrow-right"
                  class="px-0"
                >
                  Open fix plan
                </UButton>
              </div>
            </template>

            <!-- The cluster's diagnosis summary, else the execution-scope diagnosis -->
            <template #diagnosis>
              <div v-if="clusterDiagnosis" class="space-y-1.5">
                <p class="text-sm text-toned">{{ clusterDiagnosis.summary }}</p>
                <UButton
                  :to="`/failure-clusters/${failureCluster!.id}`"
                  size="xs"
                  color="neutral"
                  variant="link"
                  trailing-icon="i-lucide-arrow-right"
                  class="px-0"
                >
                  Open
                </UButton>
              </div>
              <DiagnosisPanel v-else scope="execution" :execution-id="Number(testCaseId)" />
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

            <!-- Re-run in CI, or run locally in the desktop shell -->
            <template v-if="showVerify" #verify>
              <div class="flex flex-wrap items-center gap-2">
                <UButton
                  v-if="rerunInfo?.available"
                  size="xs"
                  color="primary"
                  variant="soft"
                  icon="i-lucide-refresh-cw"
                  :loading="rerunning"
                  @click="triggerRerun"
                >
                  Re-run in CI
                </UButton>
                <DesktopRunLocallyButton
                  :project-id="testCase?.testRun?.project?.id"
                  :project-label="testCase?.testRun?.project?.label ?? testCase?.testRun?.project?.name"
                  :cases="retryCases"
                />
                <ClientOnly>
                  <span v-if="rerunInfo?.lastDispatch" class="text-xs text-muted">
                    Last re-run {{ formatRelativeTime(rerunInfo.lastDispatch.at) }}
                    <template v-if="rerunInfo.lastDispatch.byName">by {{ rerunInfo.lastDispatch.byName }}</template>
                  </span>
                </ClientOnly>
              </div>
            </template>

            <!-- Reproduce locally, then bisect the regression -->
            <template v-if="showReproduce" #reproduce>
              <ReproduceSection
                :reproduce="reproduceData!.reproduce"
                :bisect="reproduceData!.bisect"
                :context="reproduceData!.desktop"
                :project-label="testCase?.testRun?.project?.label ?? testCase?.testRun?.project?.name"
              />
            </template>

            <!-- The downstream tests this failure blocked from running -->
            <template #blocked>
              <ul class="space-y-1 text-sm">
                <li v-for="t in blockedTests" :key="t.id" class="flex items-center gap-2 min-w-0">
                  <UIcon name="i-lucide-circle-slash" class="size-3.5 shrink-0 text-amber-500" />
                  <NuxtLink :to="`/test-run-cases/${t.id}`" class="text-primary hover:underline truncate">
                    {{ t.title }}
                  </NuxtLink>
                </li>
              </ul>
            </template>
          </Toolbox>
        </div>

        <!-- ── History ────────────────────────────────────────────────── -->
        <SectionCard icon="i-lucide-history" title="History" data-shot="execution-history">
          <template #actions>
            <UButton
              v-if="testCase?.testCaseId"
              :to="`/test-cases/${testCase.testCaseId}`"
              size="xs"
              variant="outline"
              color="neutral"
              trailing-icon="i-lucide-arrow-right"
            >
              Test history
            </UButton>
          </template>
          <ClientOnly>
            <HistoryStrip v-if="historyData?.length" :history="historyData" :current-id="Number(testCaseId)" />
            <p v-else class="text-sm text-muted">No prior executions of this test yet.</p>
          </ClientOnly>
        </SectionCard>
      </div>
    </template>
  </UDashboardPanel>

  <!-- Link an issue: view and add external links for this execution. -->
  <UModal v-model:open="linksModalOpen" title="Links">
    <template #body>
      <EntityLinks
        v-if="testCase?.executionId"
        entity-type="test_case"
        :entity-id="testCase.executionId"
        :links="(testCase as any)?.stableLinks ?? null"
        @updated="refresh()"
      />
    </template>
  </UModal>
</template>
