<script setup lang="ts">
/**
 * One evidence card with content-level tabs — Timeline, Screen, Source,
 * Network, Console, State, Performance — each wrapping the evidence captured for
 * an execution. A tab shows a count or a dot when it holds data and is dimmed
 * when empty; a dimmed tab still opens and states why it is empty. The default
 * tab is the one the strongest clue cites, else Timeline when it can place two
 * or more items, else Screen. A clue or diagnosis citation switches to the tab
 * that holds the evidence and scrolls to it.
 */
import type { NetworkRequest, PerformanceStep, TraceInfo, WebVitals } from '~~/types/api';
import { getPerformanceHints } from '~/utils/performance-hints';
import { resolveEvidenceState, type EvidenceState } from '#shared/evidence-state';
import type { HelpTopicKey } from '~/utils/help-content';
import { EVIDENCE_SECTION_TAB, type EvidenceTabValue } from '~/utils/evidence-sections';

const props = defineProps<{
  /** The fetched execution — every tab reads its evidence off this object. */
  testCase: any;
  /** Traces for this execution (fetched at page level). */
  traces: TraceInfo[];
  hasTrace: boolean;
  /**
   * The story's leading clue and its strength — picks the default tab. The
   * section is the citation of the story's first member clue (or the top clue
   * when no story matched); the strength is the story's (or the top clue's). A
   * strong or medium hint opens its tab; a weak one never picks.
   */
  defaultHint?: { section: string | null; strength: 'strong' | 'medium' | 'weak' | null };
  /** Inline-help topic for the card header. */
  help?: HelpTopicKey;
}>();

type TabValue = EvidenceTabValue;

const runId = computed<number | null>(() => props.testCase?.testRun?.id ?? null);
const projectKey = computed(() => props.testCase?.testRun?.project?.id ?? undefined);
const projectName = computed(() => props.testCase?.testRun?.project?.name ?? undefined);
const testRunsCaseId = computed<number>(() => Number(props.testCase?.id ?? props.testCase?.executionId ?? 0));
const status = computed<string | null>(() => props.testCase?.status ?? null);
const hasError = computed(() => Boolean(props.testCase?.error));

const steps = computed<PerformanceStep[]>(() => (props.testCase?.steps as PerformanceStep[]) ?? []);
const webVitals = computed<WebVitals | null>(() => (props.testCase?.webVitals as unknown as WebVitals | null) ?? null);
const performanceHints = computed(() => (props.testCase ? getPerformanceHints(props.testCase) : []));
const networkRequests = computed<NetworkRequest[]>(
  () => (props.testCase?.networkRequests as unknown as NetworkRequest[] | null) ?? [],
);
const consoleLogs = computed<{ type: string; text: string; timestamp?: number; location?: string | null }[]>(
  () => props.testCase?.consoleLogs ?? [],
);
const ariaSnapshot = computed<string | null>(() => props.testCase?.ariaSnapshot ?? null);
const pageState = computed(() => props.testCase?.pageState ?? null);
const attachments = computed(() => props.testCase?.attachments ?? []);
const testSourceFrames = computed(() => props.testCase?.testSourceFrames ?? null);
const testSource = computed<string | null>(() => props.testCase?.testSource ?? null);

// ── Three-state evidence (never captured / nothing happened / not applicable) ──
const evidenceSources = computed(
  () => (props.testCase?.evidenceSources as { console?: 'trace'; network?: 'trace'; aria?: 'trace' } | null) ?? null,
);
const fixturesActive = computed(() => {
  const tc = props.testCase;
  if (!tc) return false;
  const src = evidenceSources.value ?? {};
  return (
    (consoleLogs.value.length > 0 && src.console !== 'trace') ||
    (networkRequests.value.length > 0 && src.network !== 'trace') ||
    (Boolean(ariaSnapshot.value) && src.aria !== 'trace') ||
    Boolean(pageState.value) ||
    Boolean(webVitals.value) ||
    Boolean(tc.aiUsage)
  );
});
const mk = (hasData: boolean, traced?: boolean) => ({
  hasData,
  source: traced ? ('trace' as const) : ('fixture' as const),
  fixturesActive: fixturesActive.value,
});
const consoleState = computed(() =>
  resolveEvidenceState('console', mk(consoleLogs.value.length > 0, evidenceSources.value?.console === 'trace')),
);
const networkState = computed(() =>
  resolveEvidenceState(
    'network',
    mk(networkRequests.value.length > 0 || props.hasTrace, evidenceSources.value?.network === 'trace'),
  ),
);
const appStateState = computed(() => resolveEvidenceState('appState', mk(Boolean(pageState.value))));
const ariaState = computed(() =>
  resolveEvidenceState('ariaSnapshot', mk(Boolean(ariaSnapshot.value), evidenceSources.value?.aria === 'trace')),
);
const webVitalsState = computed(() => resolveEvidenceState('webVitals', mk(Boolean(webVitals.value))));

const derived = (st: EvidenceState) => st.state === 'present' && st.derivedFromTrace;
const consoleDerived = computed(() => derived(consoleState.value));
const networkDerived = computed(() => derived(networkState.value));
const ariaDerived = computed(() => derived(ariaState.value));

// ── Tabs ──────────────────────────────────────────────────────────────────
// The data indicators read only from the already-fetched execution, never from
// a child card's later "available" signal — a cross-component write during the
// first render would tear the server and client tab strips apart.
const screenHasData = computed(
  () => attachments.value.length > 0 || props.traces.length > 0 || props.hasTrace || Boolean(ariaSnapshot.value),
);
const sourceHasData = computed(() => Boolean(testSourceFrames.value?.length || testSource.value || props.hasTrace));
const stateHasData = computed(() => Boolean(pageState.value));
const performanceHasData = computed(() => Boolean(webVitals.value) || performanceHints.value.length > 0);
const timelineHasData = computed(() => steps.value.length > 0);

// Every attempt of this execution (each retry is its own row), already fetched.
const attemptsList = computed<
  Array<{ retry: number; status: string; duration: number | null; executionId: number | null }>
>(() => props.testCase?.attempts ?? []);
const hasMultipleAttempts = computed(() => attemptsList.value.length > 1);

interface TabDef {
  value: TabValue;
  label: string;
  icon: string;
  hasData: boolean;
  count: number | null;
}
const tabs = computed<TabDef[]>(() => [
  { value: 'timeline', label: 'Timeline', icon: 'i-lucide-activity', hasData: timelineHasData.value, count: null },
  {
    value: 'attempts',
    label: 'Attempts',
    icon: 'i-lucide-repeat',
    hasData: hasMultipleAttempts.value,
    count: hasMultipleAttempts.value ? attemptsList.value.length : null,
  },
  { value: 'screen', label: 'Screen', icon: 'i-lucide-camera', hasData: screenHasData.value, count: null },
  { value: 'source', label: 'Source', icon: 'i-lucide-file-code-2', hasData: sourceHasData.value, count: null },
  {
    value: 'network',
    label: 'Network',
    icon: 'i-lucide-arrow-left-right',
    hasData: networkRequests.value.length > 0 || props.hasTrace,
    count: networkRequests.value.length || null,
  },
  {
    value: 'console',
    label: 'Console',
    icon: 'i-lucide-terminal',
    hasData: consoleLogs.value.length > 0,
    count: consoleLogs.value.length || null,
  },
  { value: 'state', label: 'State', icon: 'i-lucide-database', hasData: stateHasData.value, count: null },
  {
    value: 'performance',
    label: 'Performance',
    icon: 'i-lucide-gauge',
    hasData: performanceHasData.value,
    count: null,
  },
]);

function computeDefault(): TabValue {
  // A passing execution has no failure to lead with — open on the Timeline.
  if (!hasError.value) return 'timeline';

  // The Timeline is the best "what happened" view when it can place two or more
  // of the items a story chains — steps, network requests, console entries — so
  // a story that plays out over time (a blocked element waiting on a request the
  // console warned about) opens there, where all three read against one clock,
  // rather than on the single tab its leading clue happens to cite.
  const placeable = steps.value.length + networkRequests.value.length + consoleLogs.value.length >= 2;

  // The story's tab — only when the hint is strong or medium (a weak hint never
  // picks) and the tab is not State (State is never a default). A hint whose
  // evidence lives on the timeline (network / console / a moment on screen)
  // defers to a rich Timeline; only an off-timeline focus (the test source, the
  // performance panel) pre-empts it.
  const hint = props.defaultHint;
  if (hint?.section && (hint.strength === 'strong' || hint.strength === 'medium')) {
    const cited = EVIDENCE_SECTION_TAB[hint.section];
    if (cited && cited !== 'state') {
      const offTimeline = cited === 'source' || cited === 'performance';
      if (offTimeline || !placeable) return cited;
    }
  }

  if (placeable) return 'timeline';
  // Else Screen when a screenshot or video exists; else Source.
  if (screenHasData.value) return 'screen';
  return 'source';
}

const activeTab = ref<TabValue>(computeDefault());

// The Screen tab holds two views: the screenshot evidence and the structural
// page diff. The toggle appears once either page-diff card signals it has a
// diff — the in-execution before→failure diff or the vs-last-green diff.
const screenView = ref<'screenshot' | 'pagediff'>('screenshot');
const pageDiffAvailable = ref(false);
const traceDiffAvailable = ref(false);
const pageDiffToggleShown = computed(() => pageDiffAvailable.value || traceDiffAvailable.value);

// ── Section locator: switch to the tab holding a cited section, then scroll ──
const timelineWrap = ref<HTMLElement | null>(null);
const sourceWrap = ref<HTMLElement | null>(null);
const networkWrap = ref<HTMLElement | null>(null);
const consoleWrap = ref<HTMLElement | null>(null);
const pageStateWrap = ref<HTMLElement | null>(null);
const envDiffWrap = ref<HTMLElement | null>(null);
const screenEvidenceWrap = ref<HTMLElement | null>(null);
const visualDiffWrap = ref<HTMLElement | null>(null);
const pageDiffWrap = ref<HTMLElement | null>(null);
// The ARIA tree and the DOM snapshot now share the Page structure disclosure;
// a citation for either reveals and scrolls to it.
const pageStructureWrap = ref<HTMLElement | null>(null);
const performanceWrap = ref<HTMLElement | null>(null);
const WRAP_REF: Record<string, Ref<HTMLElement | null>> = {
  timeline: timelineWrap,
  source: sourceWrap,
  network: networkWrap,
  console: consoleWrap,
  pageState: pageStateWrap,
  envDiff: envDiffWrap,
  screenEvidence: screenEvidenceWrap,
  visualDiff: visualDiffWrap,
  pageDiff: pageDiffWrap,
  pageStructure: pageStructureWrap,
  performance: performanceWrap,
};
const SECTION_WRAP: Record<string, keyof typeof WRAP_REF> = {
  steps: 'timeline',
  failingSteps: 'timeline',
  testSource: 'source',
  sourceFiles: 'source',
  traceCallStack: 'source',
  networkRequests: 'network',
  serverTraces: 'network',
  serverLogs: 'network',
  backendLogs: 'network',
  traceNetwork: 'network',
  console: 'console',
  appState: 'pageState',
  environmentDiff: 'envDiff',
  visualDiff: 'visualDiff',
  pageDiff: 'pageDiff',
  domSnapshot: 'pageStructure',
  ariaSnapshot: 'pageStructure',
  screenshots: 'screenEvidence',
  tracePointers: 'screenEvidence',
  artifacts: 'screenEvidence',
  webVitals: 'performance',
};

const networkComp = ref<{ showTraceMode?: () => void } | null>(null);
const pageStructure = ref<{ reveal?: () => void } | null>(null);

function canLocate(sectionId: string): boolean {
  return sectionId in EVIDENCE_SECTION_TAB;
}

function revealSection(sectionId: string): boolean {
  const tab = EVIDENCE_SECTION_TAB[sectionId];
  if (!tab) return false;
  activeTab.value = tab;
  // The page diff lives behind the Screen tab's Screenshot · Page diff toggle.
  if (sectionId === 'pageDiff') screenView.value = 'pagediff';
  nextTick(() => {
    if (sectionId === 'traceNetwork') networkComp.value?.showTraceMode?.();
    // The ARIA tree and the DOM live inside the folded Page structure disclosure.
    if (sectionId === 'ariaSnapshot' || sectionId === 'domSnapshot') pageStructure.value?.reveal?.();
    const wrapKey = SECTION_WRAP[sectionId];
    if (wrapKey) WRAP_REF[wrapKey]?.value?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  return true;
}

defineExpose({ canLocate, revealSection, selectTab: (t: TabValue) => (activeTab.value = t) });
</script>

<template>
  <section class="rounded-lg border border-default bg-default max-sm:rounded-none max-sm:border-x-0">
    <!-- Header: the section title, its help, and the content-level tab strip -->
    <div class="p-3 sm:px-4 sm:py-3 border-b border-default">
      <div class="flex items-center gap-2 mb-2.5">
        <UIcon name="i-lucide-microscope" class="size-5 shrink-0 text-primary" />
        <h2 class="text-lg font-medium">Evidence</h2>
        <HelpHint v-if="help" :topic="help" />
      </div>
      <!-- Below `sm` the strip wraps onto as many rows as it needs so no tab is
           hidden off-screen; from `sm` up it stays one scrollable row. -->
      <div
        class="flex items-center gap-1 max-sm:flex-wrap sm:overflow-x-auto"
        role="tablist"
        aria-label="Evidence sections"
      >
        <button
          v-for="tab in tabs"
          :key="tab.value"
          type="button"
          role="tab"
          :aria-selected="activeTab === tab.value ? 'true' : 'false'"
          class="inline-flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-sm whitespace-nowrap outline-none focus-visible:outline-2 focus-visible:outline-primary transition-colors"
          :class="[
            activeTab === tab.value ? 'bg-primary/10 text-primary font-medium' : 'text-muted hover:bg-elevated/60',
            !tab.hasData && activeTab !== tab.value ? 'opacity-50' : '',
          ]"
          @click="activeTab = tab.value"
        >
          <UIcon :name="tab.icon" class="size-4 shrink-0" />
          {{ tab.label }}
          <UBadge v-if="tab.count" color="neutral" variant="soft" size="xs" class="tabular-nums">{{
            tab.count
          }}</UBadge>
          <span v-else-if="tab.hasData" class="size-1.5 rounded-full bg-primary/70" aria-hidden="true" />
        </button>
      </div>
    </div>

    <div class="p-3 sm:p-4">
      <!-- ── Timeline ─────────────────────────────────────────────── -->
      <!-- One view: the axis (for a failed execution) over a single steps table,
           with network / console / backend items interleaved by time. A passing
           execution shows the same table without the axis or offsets. -->
      <div v-if="activeTab === 'timeline'" ref="timelineWrap" class="scroll-mt-4">
        <FailureTimelineCard
          embedded
          :test-runs-case-id="testRunsCaseId"
          :steps="steps"
          :duration-ms="testCase?.duration ?? null"
          :has-error="hasError"
          :status="status"
          :has-trace="hasTrace"
          :project-key="projectKey"
          :project-name="projectName"
        />
      </div>

      <!-- ── Attempts ─────────────────────────────────────────────── -->
      <!-- Lazy: this card mounts only when the tab opens, fetching the diff then. -->
      <div v-else-if="activeTab === 'attempts'" class="scroll-mt-4">
        <AttemptsCard :test-runs-case-id="testRunsCaseId" :attempts="attemptsList" />
      </div>

      <!-- ── Screen ───────────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'screen'" data-shot="screen-evidence" class="space-y-4">
        <!-- Screenshot · Page diff — shown only once a diff is available. -->
        <div
          v-if="pageDiffToggleShown"
          role="tablist"
          aria-label="Screen view"
          class="inline-flex gap-1 rounded-md bg-elevated/60 p-0.5"
        >
          <button
            v-for="view in [
              { value: 'screenshot' as const, label: 'Screenshot', icon: 'i-lucide-camera' },
              { value: 'pagediff' as const, label: 'Page diff', icon: 'i-lucide-file-diff' },
            ]"
            :key="view.value"
            type="button"
            role="tab"
            :aria-selected="screenView === view.value ? 'true' : 'false'"
            class="inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-sm outline-none focus-visible:outline-2 focus-visible:outline-primary transition-colors"
            :class="
              screenView === view.value
                ? 'bg-default shadow-sm text-primary font-medium'
                : 'text-muted hover:text-default'
            "
            @click="screenView = view.value"
          >
            <UIcon :name="view.icon" class="size-4 shrink-0" />
            {{ view.label }}
          </button>
        </div>

        <div v-show="!pageDiffToggleShown || screenView === 'screenshot'" class="space-y-4">
          <div ref="screenEvidenceWrap" class="scroll-mt-4 space-y-4">
            <TestCaseEvidenceCard :attachments="attachments" :traces="traces" embedded />
          </div>
          <div class="scroll-mt-4">
            <TraceBeforeActionCard embedded :test-runs-case-id="testRunsCaseId" />
          </div>
          <div ref="visualDiffWrap" class="scroll-mt-4">
            <VisualDiffCard v-if="runId" embedded :run-id="runId" :test-runs-case-id="testRunsCaseId" />
          </div>
          <!-- The raw page structure — the ARIA tree and the failure-time DOM,
               the DOM rendered as the page, not as escaped XML — folded away
               behind one disclosure so the screenshot leads the tab. -->
          <div ref="pageStructureWrap" class="scroll-mt-4">
            <PageStructureDisclosure
              v-if="runId"
              ref="pageStructure"
              :run-id="runId"
              :test-runs-case-id="testRunsCaseId"
              :tree="ariaSnapshot"
              :tree-state="ariaState"
              :tree-derived="ariaDerived"
            />
          </div>
        </div>

        <div
          v-show="!pageDiffToggleShown || screenView === 'pagediff'"
          ref="pageDiffWrap"
          class="scroll-mt-4 space-y-4"
        >
          <TracePageDiffCard embedded :test-runs-case-id="testRunsCaseId" @available="traceDiffAvailable = $event" />
          <PageDiffCard
            v-if="runId"
            embedded
            :run-id="runId"
            :test-runs-case-id="testRunsCaseId"
            @available="pageDiffAvailable = $event"
          />
        </div>
      </div>

      <!-- ── Source ───────────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'source'" ref="sourceWrap" class="scroll-mt-4">
        <TestSourceCard
          v-if="sourceHasData"
          embedded
          :frames="testSourceFrames"
          :test-source="testSource"
          :run-id="runId"
          :test-runs-case-id="testRunsCaseId"
          :has-trace="hasTrace"
          :project-key="projectKey"
          :project-name="projectName"
        />
        <EmptyState v-else icon="i-lucide-file-code-2" text="No test source captured for this execution" />
      </div>

      <!-- ── Network ──────────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'network'" ref="networkWrap" class="scroll-mt-4">
        <TestCaseNetworkRequests
          v-if="networkRequests.length > 0 || hasTrace"
          ref="networkComp"
          embedded
          :requests="networkRequests"
          :run-id="runId"
          :test-runs-case-id="testRunsCaseId"
          :has-trace="hasTrace"
          :derived-from-trace="networkDerived"
        />
        <SectionCard v-else embedded title="">
          <EvidenceEmptyState :state="networkState" compact />
        </SectionCard>
      </div>

      <!-- ── Console ──────────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'console'" ref="consoleWrap" class="scroll-mt-4">
        <TestCaseConsoleCard
          v-if="consoleLogs.length"
          embedded
          :entries="consoleLogs"
          :derived-from-trace="consoleDerived"
        />
        <SectionCard v-else embedded title="">
          <EvidenceEmptyState :state="consoleState" compact />
        </SectionCard>
      </div>

      <!-- ── State ────────────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'state'" class="space-y-4">
        <div ref="pageStateWrap" class="scroll-mt-4">
          <PageStateCard v-if="pageState" embedded :page-state="pageState" />
          <SectionCard v-else embedded title="">
            <EvidenceEmptyState :state="appStateState" compact />
          </SectionCard>
        </div>
        <div ref="envDiffWrap" class="scroll-mt-4">
          <EnvironmentDiffCard v-if="runId" embedded :run-id="runId" :test-runs-case-id="testRunsCaseId" />
        </div>
      </div>

      <!-- ── Performance ──────────────────────────────────────────── -->
      <div v-else-if="activeTab === 'performance'" ref="performanceWrap" class="scroll-mt-4">
        <TestCasePerformancePanel
          embedded
          :performance-hints="performanceHints"
          :web-vitals="webVitals"
          :state="webVitalsState"
        />
      </div>
    </div>
  </section>
</template>
