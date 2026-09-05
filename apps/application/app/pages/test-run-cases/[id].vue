<script setup lang="ts">
import type { AiStepIntent, AttemptOutcome, TestCaseHistoryPoint, TraceInfo } from '~~/types/api';
import { isPiwiAnnotation } from '@piwitests/core/test-meta';
import { renderAnsi } from '~/utils';
import { buildRetryCommand } from '~/utils/retry-command';
import type { FailureVerdict } from '#shared/failure-verdict';
import type { FailureCluesResult } from '#shared/handlers/test-cases';
import { clusterSectionLocatorKey } from '~/composables/useClusterSectionLocator';
import { EVIDENCE_SECTION_TAB } from '~/utils/evidence-sections';
import type { FixSectionKey } from '~/components/shared/FixCard.vue';
import type { BlockedCaseRef } from '~~/types/api';
import type { ReproRecipe, BisectResult, ReproduceDesktopContext } from '#shared/reproduce';
import type { FixedBeforeMatch } from '#shared/fix-plan.types';

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

// The deterministic clues for this execution: fed to the headline (top clue as
// one line), the CluesCard, and the evidence tabs' default-tab choice.
const { data: cluesData } = await useFetch<FailureCluesResult>(`/api/test-run-cases/${testCaseId}/clues`, {
  default: (): FailureCluesResult => ({ clues: [], failureAt: null }),
});
const clues = computed(() => cluesData.value?.clues ?? []);
const cluesFailureAt = computed(() => cluesData.value?.failureAt ?? null);
const topClue = computed(() => clues.value[0] ?? null);
const topClueSection = computed(() => topClue.value?.citations?.[0]?.section ?? null);
// The headline prints the strongest clue, so the Other clues card lists the rest.
const otherClues = computed(() => clues.value.slice(1));

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

// ── Retry command (header primary action) ───────────────────────────────────
const retryCases = computed(() => [
  {
    filePath: testCase.value?.filePath ?? '',
    title: testCase.value?.title ?? '',
    line: testCase.value?.line ?? null,
    projectName: (testCase.value?.browser as { projectName?: string } | null)?.projectName ?? null,
  },
]);
const retryCommand = computed(() => buildRetryCommand(retryCases.value));
const { copy: copyRetry, copied: retryCopied } = useCopy();
const retryTitle = computed(() => (retryCopied.value ? 'Copied!' : copyPreview(retryCommand.value)));

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
// tabs handle the tabbed sections (switch tab + scroll), while the on-page error
// and locator-fix blocks scroll in place.
const headlineCard = ref<{ revealError: () => void } | null>(null);
const fixCardEl = ref<HTMLElement | null>(null);
const evidenceTabs = ref<{
  canLocate: (id: string) => boolean;
  revealSection: (id: string) => boolean;
  selectTab: (t: string) => void;
} | null>(null);

function scrollToEl(el: HTMLElement | null) {
  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}
// The raw error lives in the headline card's disclosure; the locator fix lives
// in the Fix card. A citation reveals or scrolls to the block that holds it.
const pageSections: Record<string, () => void> = {
  sampleError: () => headlineCard.value?.revealError(),
  executionError: () => headlineCard.value?.revealError(),
  locatorHealing: () => scrollToEl(fixCardEl.value),
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
        <!-- ── Header ─────────────────────────────────────────────────── -->
        <DetailHeader :status="testCase?.status ?? ''" :title="testCase?.title ?? ''" :badges="headerBadges">
          <template #badges-extra>
            <QuarantinedChip v-if="quarantined" />
          </template>

          <template #primary>
            <UButton
              v-if="retryCommand && !desktopBridge"
              size="xs"
              color="warning"
              variant="subtle"
              :icon="retryCopied ? 'i-lucide-check' : 'i-lucide-clipboard'"
              :title="retryTitle"
              aria-label="Copy retry command"
              @click="copyRetry(retryCommand, { toast: 'Retry command copied' })"
            >
              <span class="hidden sm:inline">Copy retry command</span>
            </UButton>
            <DesktopRunLocallyButton
              :project-id="testCase?.testRun?.project?.id"
              :project-label="testCase?.testRun?.project?.label ?? testCase?.testRun?.project?.name"
              :cases="retryCases"
            />
          </template>

          <template #facts>
            <OpenInIdeLink
              v-if="ideTarget?.filePath || testCase?.location"
              :file-path="ideTarget?.filePath"
              :line="ideTarget?.line"
              :location="ideTarget ? undefined : (testCase?.location ?? undefined)"
              :project-key="testCase?.testRun?.project?.id"
              :project-name="testCase?.testRun?.project?.name"
            />
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
            <span v-if="scmInfo?.branch || scmInfo?.commit" class="inline-flex items-center gap-1">
              <UIcon name="i-lucide-git-branch" class="size-3.5 shrink-0" />
              <span v-if="scmInfo?.branch" class="font-medium">{{ scmInfo.branch }}</span>
              <code v-if="scmInfo?.commit" class="font-mono bg-elevated px-1 py-0.5 rounded" :title="scmInfo.commit">{{
                scmInfo.commit.length >= 8 ? scmInfo.commit.substring(0, 8) : scmInfo.commit
              }}</code>
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
          </template>

          <template #details>
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
            <div v-if="testCase?.testRun?.playwrightVersion || testCase?.testRun?.reporterVersion" class="space-y-1">
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
                <span v-if="testCase.slowestStepDuration">(<DurationValue :ms="testCase.slowestStepDuration" />)</span>
              </p>
              <p v-if="(testCase?.wastedTimeMs ?? 0) > 0">
                Wasted in fixed waits: <DurationValue :ms="testCase?.wastedTimeMs" />
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
          </template>
        </DetailHeader>

        <!-- Why this execution never ran — the whole story for a did-not-run case. -->
        <DidNotRunCard
          :status="testCase?.status"
          :reason="(testCase as any)?.didNotRunReason ?? null"
          :blocked-by-case="(testCase as any)?.blockedByCase ?? null"
        />

        <!-- ── What broke, in one line, with the raw error one click away ── -->
        <TestCaseHeadlineCard
          v-if="verdict"
          ref="headlineCard"
          :verdict="verdict"
          :top-clue="topClue"
          :cluster-triage-status="failureCluster?.status ?? null"
          :error="testCase?.error ?? null"
          @copy-failure="copyFailure"
        />

        <!-- The clues after the strongest one — the headline prints the first -->
        <CluesCard :clues="otherClues" :failure-at="cluesFailureAt" title="Other clues" />

        <!-- ── Evidence ───────────────────────────────────────────────── -->
        <EvidenceTabs
          ref="evidenceTabs"
          :test-case="testCase"
          :traces="(traceData as TraceInfo[]) ?? []"
          :has-trace="hasTrace"
          :default-section="topClueSection"
        />

        <!-- ── What to do ─────────────────────────────────────────────── -->
        <div ref="fixCardEl" class="scroll-mt-4">
          <FixCard v-if="showFix" :sections="fixSections" help="case.fix">
            <!-- Ranked replacement locators for a broken locator -->
            <template #locator-fix>
              <LocatorHealingPanel
                v-if="testCase?.testRun?.id"
                :run-id="testCase.testRun.id"
                :test-runs-case-id="Number(testCaseId)"
                :ai-intents="aiIntents"
                :chrome="false"
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
            <template v-if="showReproduce" #reproduce-label>
              <span class="inline-flex items-center gap-1">Reproduce <HelpHint topic="fix.reproduce" /></span>
            </template>
            <template v-if="showReproduce" #reproduce>
              <ReproduceSection
                :reproduce="reproduceData!.reproduce"
                :bisect="reproduceData!.bisect"
                :context="reproduceData!.desktop"
                :project-label="testCase?.testRun?.project?.label ?? testCase?.testRun?.project?.name"
              />
            </template>

            <!-- The downstream tests this failure blocked from running -->
            <template #blocked-label>Blocked by this failure ({{ blockedTests.length }})</template>
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
          </FixCard>
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
