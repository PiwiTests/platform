<script setup lang="ts">
/**
 * The right-side facts of a project-catalog `TestRow`: how often the test ran,
 * its pass rate and status mix, its average duration and when it last ran. Kept
 * in one place so the flat list and the file grouping read identically.
 */
import type { TestCaseWithStats } from '~~/types/api';

defineProps<{ tc: TestCaseWithStats }>();
</script>

<template>
  <span class="tabular-nums text-muted">{{ tc.totalRuns }} {{ tc.totalRuns === 1 ? 'run' : 'runs' }}</span>
  <PassRateIndicator :rate="tc.passRate" />
  <div class="w-32 shrink-0">
    <TestStatusBar
      :passed="tc.passedRuns"
      :failed="tc.failedRuns"
      :skipped="tc.skippedRuns"
      :flaky="tc.flakyRuns"
      :did-not-run="tc.didNotRunRuns"
      :total="tc.totalRuns"
    />
  </div>
  <DurationValue v-if="tc.avgDuration != null" :ms="tc.avgDuration" class="tabular-nums" />
  <span class="tabular-nums" :title="prettyDateFormat(tc.lastRun)">
    {{ tc.lastRun != null ? formatRelativeTime(tc.lastRun) : '—' }}
  </span>
</template>
