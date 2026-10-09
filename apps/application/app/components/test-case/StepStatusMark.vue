<script setup lang="ts">
/**
 * The round mark in front of a step of the execution timeline: `–` when the
 * test did not run, a `✗` in the failed outcome color for a failure (the step
 * that failed, a step around it, or another error the test ended with), a grey
 * `✗` for an error the test caught and went on from, and a muted `✓` for a step
 * that passed, so the failure is the only colored mark in the column.
 */
import type { StepFailureRole } from '#shared/step-tree';

const props = defineProps<{
  /** The step's part in the failure; null for a step that passed. */
  role: StepFailureRole | null;
  /** The execution did not run: every step shows the neutral mark. */
  notRun?: boolean;
}>();

const FAILED_TITLE: Record<Exclude<StepFailureRole, 'recovered'>, string> = {
  failing: 'Step failed',
  enclosing: 'The failure happened inside this step',
  failed: 'Step failed too: another error the test ended with',
};

const mark = computed(() => {
  if (props.notRun) {
    return { text: '–', title: 'Not run', class: 'bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500' };
  }
  if (props.role === 'recovered') {
    return {
      text: '✗',
      title: 'Error caught: the test continued',
      class: 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400',
    };
  }
  if (props.role) {
    return { text: '✗', title: FAILED_TITLE[props.role], class: STATUS_PALETTE.failed.chip };
  }
  return { text: '✓', title: 'Step passed', class: 'text-muted' };
});
</script>

<template>
  <span
    class="inline-flex items-center justify-center size-5 shrink-0 rounded-full text-xs leading-none"
    :class="mark.class"
    :title="mark.title"
    >{{ mark.text }}</span
  >
</template>
