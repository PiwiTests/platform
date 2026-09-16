<script setup lang="ts">
/**
 * The facts line under an execution's situation block: the source path (open in
 * IDE), the run facts that collapse to Details on mobile (browser, duration,
 * attempts, branch, build, age), the Details popover with everything else, and
 * the shared "Raw error ▸" disclosure with its Copy failure action.
 *
 * The secondary facts render once and are hidden below `sm`; the Details popover
 * repeats the mobile-critical ones so the phone layout keeps them reachable.
 * `revealRawError()` opens the raw error from a citation elsewhere on the page.
 */
import type { AttemptOutcome, TestCaseHistoryPoint } from '~~/types/api';

const props = defineProps<{
  /** The fetched execution — every fact reads off this object. */
  testCase: any;
  /** Prior executions of this test, for the duration-vs-average note. */
  history?: TestCaseHistoryPoint[];
}>();

const emit = defineEmits<{ copyFailure: [] }>();

const metadata = computed(() => props.testCase?.testRun?.metadata as Record<string, unknown> | null | undefined);
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
const environment = computed(() => props.testCase?.testRun?.environment);
const browser = computed(() => props.testCase?.browser ?? null);
const stepsCount = computed(() => (props.testCase?.steps as unknown[] | null)?.length ?? 0);

// The first captured source frame — the failing line — beats the test()
// declaration for the "open in IDE" link.
const ideTarget = computed(() => {
  const frames = (props.testCase as { testSourceFrames?: Array<{ filePath?: string; line?: number }> | null } | null)
    ?.testSourceFrames;
  const frame = frames?.[0];
  if (!frame?.filePath) return null;
  return { filePath: frame.filePath, line: frame.line };
});

const historicalTiming = computed(() => {
  const history = props.history;
  if (!history || history.length < 2 || !props.testCase?.duration) return null;
  const previous = history.filter((h) => h.duration !== null && h.id !== props.testCase?.id);
  if (previous.length === 0) return null;
  const avg = previous.reduce((sum, h) => sum + (h.duration || 0), 0) / previous.length;
  const current = props.testCase.duration;
  const diff = current - avg;
  const pct = avg > 0 ? Math.round((diff / avg) * 100) : 0;
  return { avg: Math.round(avg), current, diff: Math.round(diff), pct };
});

const attempts = computed(() => props.testCase?.attempts ?? null);
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
  return a.retry === (props.testCase?.retries ?? 0);
}
function attemptLink(a: AttemptOutcome): string | null {
  return !isCurrentAttempt(a) && a.executionId ? `/test-run-cases/${a.executionId}` : null;
}

const disclosure = ref<{ reveal: () => void } | null>(null);
function revealRawError() {
  disclosure.value?.reveal();
}
defineExpose({ revealRawError });
</script>

<template>
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
        <DurationValue :ms="testCase?.duration" />
        <span v-if="historicalTiming">
          (avg <DurationValue :ms="historicalTiming.avg" />, {{ historicalTiming.diff > 0 ? '+' : ''
          }}{{ historicalTiming.pct }}%)
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
      <BranchLabel v-if="scmInfo?.branch" :name="scmInfo.branch" class="max-w-[12rem]" copyable />
      <a
        v-if="ciInfo?.buildUrl || ciInfo?.buildNumber"
        :href="ciInfo?.buildUrl || undefined"
        :target="ciInfo?.buildUrl ? '_blank' : undefined"
        :class="ciInfo?.buildUrl ? SENTENCE_LINK_CLASS : ''"
      >
        {{ ciInfo?.buildNumber ? `Build #${ciInfo.buildNumber}` : 'View build' }}
      </a>
      <ClientOnly>
        <span v-if="testCase?.startedAt" :title="new Date(testCase.startedAt).toLocaleString()">
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
              Branch: <BranchLabel :name="scmInfo.branch" class="text-highlighted" inherit copyable />
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
          <div v-if="testCase?.testRun?.playwrightVersion || testCase?.testRun?.reporterVersion" class="space-y-1">
            <p class="text-xs font-medium text-muted uppercase tracking-wide">Tooling</p>
            <p>
              <template v-if="testCase?.testRun?.playwrightVersion"
                >Playwright v{{ testCase.testRun.playwrightVersion }}</template
              >
              <template v-if="testCase?.testRun?.playwrightVersion && testCase?.testRun?.reporterVersion"> · </template>
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
    <RawErrorDisclosure ref="disclosure" :error="testCase?.error" condense>
      <template #actions>
        <UButton
          size="xs"
          variant="ghost"
          color="neutral"
          icon="i-lucide-clipboard"
          aria-label="Copy failure"
          title="Copy failure"
          @click="emit('copyFailure')"
        >
          Copy failure
        </UButton>
      </template>
    </RawErrorDisclosure>
  </div>
</template>
