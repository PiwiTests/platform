<script setup lang="ts">
/**
 * A running project deletion, step by step: the stored files, the test runs
 * (counted as they go, which also fills the bar) and the rest of the project,
 * then the time spent so far. Until a phase is reported the bar runs alone,
 * indeterminate.
 */
import type { ProjectDeletionProgress } from '#shared/handlers/projects';

const props = defineProps<{
  progress: ProjectDeletionProgress | null;
  elapsedMs: number;
}>();

type Phase = ProjectDeletionProgress['phase'];
const PHASES: Phase[] = ['files', 'runs', 'project'];

function stepState(phase: Phase): 'ok' | 'pending' | 'waiting' {
  const current = PHASES.indexOf(props.progress?.phase ?? 'files');
  const step = PHASES.indexOf(phase);
  if (step < current) return 'ok';
  return step === current ? 'pending' : 'waiting';
}

const count = (n: number) => n.toLocaleString(viewerLocale());

const runsText = computed(() => {
  const total = props.progress?.totalRuns ?? 0;
  return total ? `Deleting ${count(total)} test run${total === 1 ? '' : 's'}` : 'Deleting test runs';
});

/** Runs deleted so far, while that phase runs. */
const runsDone = computed(() => {
  const p = props.progress;
  return p?.phase === 'runs' && p.totalRuns > 0 ? p.runsDeleted : null;
});

const runsHint = computed(() =>
  runsDone.value === null ? null : `${count(runsDone.value)} of ${count(props.progress!.totalRuns)} deleted`,
);

/** Percent of runs deleted; null (an indeterminate bar) outside that phase. */
const barValue = computed(() =>
  runsDone.value === null ? null : Math.round((runsDone.value / props.progress!.totalRuns) * 100),
);
</script>

<template>
  <div class="space-y-4" data-shot="project-delete-progress">
    <UProgress :model-value="barValue" size="sm" />
    <div v-if="progress" class="space-y-2" data-testid="project-delete-steps">
      <CheckResultLine
        :state="stepState('files')"
        text="Removing stored files"
        hint="Reports, traces, screenshots and videos"
      />
      <CheckResultLine :state="stepState('runs')" :text="runsText" :hint="runsHint" />
      <CheckResultLine :state="stepState('project')" text="Deleting test cases, failure clusters and settings" />
    </div>
    <p class="text-xs text-muted">
      {{ elapsedMs >= 1000 ? `Running for ${formatLongDuration(elapsedMs)}.` : 'Starting…' }}
      The deletion continues on the server if you leave this page.
    </p>
  </div>
</template>
