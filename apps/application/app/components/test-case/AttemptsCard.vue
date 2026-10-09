<script setup lang="ts">
/**
 * The Attempts tab for a flaky test: a strip of every attempt (retry number,
 * status, duration, a "this one" marker on the opened execution), and below it
 * "what differed" between the failing attempt and the attempt that passed on
 * retry — the flakiness fingerprint. The diff is loaded lazily from
 * `/attempt-diff` when the tab is first opened (this card mounts under a `v-if`).
 *
 * Each difference cites an evidence section; the chip switches to that evidence
 * tab through the page's section locator — the same mechanism a clue uses. A
 * network row whose route is one of the test's flake suspects (slower on the
 * failing attempt, or failed only there) links to that suspect on the test's
 * Flakiness tab; the profile is read only when such a row exists.
 */
import type { AttemptDiffEntry } from '#shared/attempt-diff';
import type { AttemptDiffResult } from '#shared/handlers/test-cases';
import type { FlakeProfile, FlakeSuspect } from '#shared/handlers/flake-profile';
import { useClusterSectionLocator } from '~/composables/useClusterSectionLocator';

const props = defineProps<{
  testRunsCaseId: number;
  /** Every attempt of this execution, already fetched at page level. */
  attempts: Array<{ retry: number; status: string; duration: number | null; executionId: number | null }>;
  /** The project, so the suspect links follow its flake-suspects decision. */
  projectId?: number | null;
}>();

const { data, status } = await useFetch<AttemptDiffResult>(
  () => `/api/test-run-cases/${props.testRunsCaseId}/attempt-diff`,
);
const { isHidden: capabilityHidden } = await useProjectCapabilities(props.projectId ?? 0);

const locator = useClusterSectionLocator();

// The endpoint's attempt list is authoritative (it unions every attempt row);
// the page-level `attempts` prop is the fallback while the diff is loading.
const orderedAttempts = computed(() => {
  const source = data.value?.attempts?.length ? data.value.attempts : (props.attempts ?? []);
  return [...source].sort((a, b) => (a.retry ?? 0) - (b.retry ?? 0));
});

const differences = computed<AttemptDiffEntry[]>(() => data.value?.differences ?? []);
const applicable = computed(() => data.value?.applicable === true);

// ── Per-kind presentation ──────────────────────────────────────────────────
const KIND_ICON: Record<AttemptDiffEntry['kind'], string> = {
  error: 'i-lucide-circle-x',
  network: 'i-lucide-arrow-left-right',
  console: 'i-lucide-terminal',
  step: 'i-lucide-list-checks',
  duration: 'i-lucide-timer',
  'page-state': 'i-lucide-database',
  aria: 'i-lucide-scan-text',
};

/** Where a difference's citation jumps — evidence section id → readable tab name. */
const SECTION_LABEL: Record<string, string> = {
  executionError: 'Error',
  networkRequests: 'Network',
  console: 'Console',
  steps: 'Timeline',
  appState: 'State',
  ariaSnapshot: 'Screen',
};

function onlyLabel(entry: AttemptDiffEntry): { text: string; class: string } {
  if (entry.only === 'failing') {
    return { text: 'only on the failing attempt', class: STATUS_PALETTE.failed.chip };
  }
  if (entry.only === 'passing') {
    return { text: 'only on the passing attempt', class: STATUS_PALETTE.passed.chip };
  }
  return { text: 'changed', class: 'text-amber-600 dark:text-amber-400 bg-amber-500/10' };
}

function citationLabel(entry: AttemptDiffEntry): string | null {
  const section = entry.ref?.section;
  if (!section || !locator.canLocate(section)) return null;
  return SECTION_LABEL[section] ?? null;
}

function reveal(entry: AttemptDiffEntry) {
  const section = entry.ref?.section;
  if (section && locator.canLocate(section)) locator.open(section);
}

// ── Links to flake suspects ─────────────────────────────────────────────────
const profile = ref<FlakeProfile | null>(null);
watch(
  () => data.value,
  async (diff) => {
    const testCaseId = diff?.testCaseId;
    const hasRouteRow = (diff?.differences ?? []).some((d) => d.route);
    if (!testCaseId || !hasRouteRow || !props.projectId || capabilityHidden('flake-lab')) return;
    try {
      profile.value = await $fetch<FlakeProfile>(`/api/test-cases/${testCaseId}/flake-profile`);
    } catch {
      // The links are optional; the diff reads the same without them.
    }
  },
  { immediate: true },
);

/** The suspect a network row stands for: a slower request, or a request that failed only on the failing attempt. */
function suspectFor(entry: AttemptDiffEntry): FlakeSuspect | null {
  if (entry.kind !== 'network' || !entry.route || !profile.value) return null;
  const kind = entry.only === 'failing' ? 'failed-route' : entry.only ? null : 'slow-route';
  if (!kind) return null;
  return profile.value.suspects.find((s) => s.kind === kind && s.route === entry.route) ?? null;
}

function suspectLink(suspect: FlakeSuspect): string {
  return `/test-cases/${profile.value!.testCaseId}?tab=flakiness&suspect=${encodeURIComponent(suspect.id)}`;
}

function attemptLabel(retry: number): string {
  return retry === 0 ? 'Attempt 1' : `Retry ${retry}`;
}
</script>

<template>
  <div class="space-y-4" data-shot="attempts-diff">
    <!-- ── Attempt strip ──────────────────────────────────────────────────── -->
    <SectionCard embedded icon="i-lucide-repeat" title="Attempts" help="case.attempts">
      <ul class="flex flex-col sm:flex-row sm:flex-wrap gap-2">
        <li
          v-for="attempt in orderedAttempts"
          :key="attempt.retry"
          class="flex items-center gap-2 rounded-md border border-default px-2.5 py-1.5 text-sm"
          :class="attempt.executionId === testRunsCaseId ? SELECTED_ROW_CLASS : ''"
          :aria-current="attempt.executionId === testRunsCaseId ? 'true' : undefined"
        >
          <span class="font-medium whitespace-nowrap">{{ attemptLabel(attempt.retry) }}</span>
          <StatusChip :status="attempt.status" size="xs" />
          <DurationValue :ms="attempt.duration" class="text-muted tabular-nums" />
          <span v-if="attempt.executionId === testRunsCaseId" class="text-xs text-muted whitespace-nowrap"
            >this one</span
          >
          <NuxtLink
            v-else-if="attempt.executionId"
            :to="`/test-run-cases/${attempt.executionId}`"
            class="text-xs whitespace-nowrap"
            :class="SENTENCE_LINK_CLASS"
            >open</NuxtLink
          >
        </li>
      </ul>
    </SectionCard>

    <!-- ── What differed ──────────────────────────────────────────────────── -->
    <SectionCard embedded icon="i-lucide-git-compare" title="What differed" help="case.attempts">
      <LoadingState v-if="status === 'pending'" text="Comparing attempts…" />

      <EmptyState
        v-else-if="!applicable"
        icon="i-lucide-repeat"
        text="No failing-and-passing pair to compare — this needs one attempt that failed and one that passed."
      />

      <EmptyState
        v-else-if="differences.length === 0"
        icon="i-lucide-equal"
        text="The failing and passing attempts left no different evidence — the flakiness is not visible in the captured signals."
      />

      <ul v-else class="space-y-2.5">
        <li
          v-for="(entry, i) in differences"
          :key="i"
          class="flex items-start gap-2.5 rounded-md border border-default p-2.5"
        >
          <UIcon :name="KIND_ICON[entry.kind]" class="size-4 shrink-0 mt-0.5 text-muted" />
          <div class="min-w-0 flex-1 space-y-1">
            <div class="flex flex-wrap items-center gap-2">
              <span
                class="rounded px-1.5 py-0.5 text-xs font-medium whitespace-nowrap"
                :class="onlyLabel(entry).class"
                >{{ onlyLabel(entry).text }}</span
              >
              <span class="text-sm font-medium break-words">{{ entry.summary }}</span>
            </div>
            <pre
              v-if="entry.detail"
              class="text-xs text-muted font-mono whitespace-pre-wrap break-words max-h-32 overflow-y-auto"
              >{{ entry.detail }}</pre>
            <div class="flex flex-wrap items-center gap-x-4 gap-y-1">
              <button
                v-if="citationLabel(entry)"
                type="button"
                class="text-xs text-muted hover:text-highlighted"
                :class="SENTENCE_LINK_CLASS"
                @click="reveal(entry)"
              >
                View in {{ citationLabel(entry) }}
              </button>
              <NuxtLink
                v-if="suspectFor(entry)"
                :to="suspectLink(suspectFor(entry)!)"
                class="text-xs text-muted hover:text-highlighted"
                :class="SENTENCE_LINK_CLASS"
                data-testid="attempt-suspect-link"
                :title="suspectFor(entry)!.sentence"
              >
                Flake suspect: {{ suspectFor(entry)!.counts.failuresWith }} of
                {{ suspectFor(entry)!.counts.failures }} failures
              </NuxtLink>
            </div>
          </div>
        </li>
      </ul>
    </SectionCard>
  </div>
</template>
