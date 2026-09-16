<script setup lang="ts">
/**
 * The Attempts tab for a flaky test: a strip of every attempt (retry number,
 * status, duration, a "this one" marker on the opened execution), and below it
 * "what differed" between the failing attempt and the attempt that passed on
 * retry — the flakiness fingerprint. The diff is loaded lazily from
 * `/attempt-diff` when the tab is first opened (this card mounts under a `v-if`).
 *
 * Each difference cites an evidence section; the chip switches to that evidence
 * tab through the page's section locator — the same mechanism a clue uses.
 */
import type { AttemptDiffEntry } from '#shared/attempt-diff';
import type { AttemptDiffResult } from '#shared/handlers/test-cases';
import { useClusterSectionLocator } from '~/composables/useClusterSectionLocator';

const props = defineProps<{
  testRunsCaseId: number;
  /** Every attempt of this execution, already fetched at page level. */
  attempts: Array<{ retry: number; status: string; duration: number | null; executionId: number | null }>;
}>();

const { data, status } = await useFetch<AttemptDiffResult>(`/api/test-run-cases/${props.testRunsCaseId}/attempt-diff`);

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
    return { text: 'only on the failing attempt', class: 'text-red-600 dark:text-red-400 bg-red-500/10' };
  }
  if (entry.only === 'passing') {
    return { text: 'only on the passing attempt', class: 'text-green-600 dark:text-green-400 bg-green-500/10' };
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
          :class="attempt.executionId === testRunsCaseId ? 'bg-primary/5 border-primary/40' : ''"
        >
          <span class="font-medium whitespace-nowrap">{{ attemptLabel(attempt.retry) }}</span>
          <StatusChip :status="attempt.status" size="xs" />
          <DurationValue :ms="attempt.duration" class="text-muted tabular-nums" />
          <span v-if="attempt.executionId === testRunsCaseId" class="text-xs text-primary font-medium whitespace-nowrap"
            >this one</span
          >
          <ULink
            v-else-if="attempt.executionId"
            :to="`/test-run-cases/${attempt.executionId}`"
            class="text-xs text-primary hover:underline whitespace-nowrap"
            >open</ULink
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
            <button
              v-if="citationLabel(entry)"
              type="button"
              class="inline-flex items-center gap-1 text-xs text-primary hover:underline"
              @click="reveal(entry)"
            >
              <UIcon name="i-lucide-arrow-up-right" class="size-3" />
              View in {{ citationLabel(entry) }}
            </button>
          </div>
        </li>
      </ul>
    </SectionCard>
  </div>
</template>
