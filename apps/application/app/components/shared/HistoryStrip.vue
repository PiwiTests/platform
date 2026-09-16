<script setup lang="ts">
/**
 * This test's recent executions as a row of clickable squares, oldest to newest,
 * colored by status with the current execution ringed, above a one-line streak
 * sentence anchored to the execution being viewed. Each square links to its
 * execution. No chart, no table — the full history lives on the test page.
 */
import type { TestCaseHistoryPoint } from '~~/types/api';

const props = withDefaults(
  defineProps<{
    history: TestCaseHistoryPoint[];
    /** The current execution's id — ringed in the strip and the streak anchor. */
    currentId?: number | null;
    /**
     * Squares only, no descriptive label and no streak sentence — for the test
     * history chart's footer, where the facts line already carries the numbers.
     */
    compact?: boolean;
  }>(),
  { currentId: null, compact: false },
);

const isFail = (s?: string | null) => s === 'failed' || s === 'timedOut' || s === 'timedout';

/** Oldest → newest, capped at 24, for the strip. */
const strip = computed(() => props.history.slice(0, 24).slice().reverse());

/**
 * The failing streak and the most recent green run, anchored to the execution
 * being viewed (not the newest one) so an older execution reached via a deep
 * link gets a verdict about itself. History is desc by run start, so entries
 * after the anchor index are older.
 */
const streak = computed(() => {
  const h = props.history;
  if (!h.length) return null;
  const anchor = Math.max(
    0,
    h.findIndex((p) => p.id === props.currentId),
  );
  let count = 0;
  for (let i = anchor; i < h.length; i++) {
    if (isFail(h[i]!.status)) count++;
    else break;
  }
  let lastPass: TestCaseHistoryPoint | null = null;
  for (let i = anchor + 1; i < h.length; i++) {
    if (h[i]!.status === 'passed') {
      lastPass = h[i]!;
      break;
    }
  }
  return { count, lastPass, total: h.length, anchorPassed: h[anchor]?.status === 'passed' };
});

const stripLabelId = useId();

const squareClass = (status: string) => ({
  'bg-red-500 hover:bg-red-600': isFail(status),
  'bg-green-500 hover:bg-green-600': status === 'passed',
  'bg-yellow-500 hover:bg-yellow-600': status === 'skipped',
  'bg-gray-400 hover:bg-gray-500': !isFail(status) && !['passed', 'skipped'].includes(status),
});
</script>

<template>
  <div v-if="strip.length" class="space-y-2">
    <div>
      <p v-if="!compact" :id="stripLabelId" class="text-xs text-gray-400 mb-1">
        Recent executions of this test (oldest → newest)
      </p>
      <div
        class="flex items-center gap-1 flex-wrap"
        role="group"
        :aria-labelledby="compact ? undefined : stripLabelId"
        :aria-label="compact ? 'Recent executions of this test, oldest to newest' : undefined"
      >
        <UTooltip v-for="point in strip" :key="point.id" :text="`Execution in run #${point.runId}: ${point.status}`">
          <NuxtLink
            :to="`/test-run-cases/${point.id}`"
            :aria-label="`Execution in run #${point.runId}: ${formatStatusLabel(point.status)}`"
            :aria-current="point.id === currentId ? 'true' : undefined"
            class="size-3.5 rounded-sm inline-block transition-colors outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary"
            :class="[squareClass(point.status), point.id === currentId ? 'ring-2 ring-offset-1 ring-primary' : '']"
          />
        </UTooltip>
      </div>
    </div>

    <p v-if="!compact && streak && streak.count >= 1" class="text-sm text-gray-600 dark:text-gray-400">
      Failing for
      <strong class="text-gray-800 dark:text-gray-200">{{ streak.count }}</strong>
      consecutive run{{ streak.count === 1 ? '' : 's' }}.
      <template v-if="streak.lastPass">
        Last passed in
        <NuxtLink :to="`/test-run-cases/${streak.lastPass.id}`" class="text-primary hover:underline">
          run #{{ streak.lastPass.runId }}
        </NuxtLink>
        ({{ formatRelativeTime(streak.lastPass.startTime) }}).
      </template>
      <template v-else-if="streak.total > 1"> No passing run in the last {{ streak.total }} recorded. </template>
      <template v-else> First recorded run of this test. </template>
    </p>
    <p v-else-if="!compact && streak?.anchorPassed" class="text-sm text-gray-600 dark:text-gray-400">
      This execution passed.
    </p>
  </div>
</template>
