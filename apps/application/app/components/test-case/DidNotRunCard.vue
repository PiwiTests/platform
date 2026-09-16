<script setup lang="ts">
/**
 * Explains a `didnotrun` execution and the failing test it links to. Renders in
 * two directions of the same serial-group cascade:
 *  - on a test that never ran, *why* (global timeout, max failures, an
 *    interruption, or a preceding failure) and — for a cascade — a link to the
 *    test that blocked it;
 *  - on a failing test, the downstream tests it stopped from running.
 *
 * Nothing shows unless there is something to say, so the page can mount it
 * unconditionally.
 */
import type { BlockedCaseRef } from '~~/types/api';

const props = defineProps<{
  /** Status of the execution being viewed. */
  status?: string | null;
  /** Why this execution never ran (only meaningful when status is `didnotrun`). */
  reason?: string | null;
  /** The failing execution that blocked this one (cascade upstream). */
  blockedByCase?: BlockedCaseRef | null;
  /** Executions this one stopped from running (cascade downstream). */
  blockedTests?: BlockedCaseRef[] | null;
}>();

const didNotRun = computed(() => props.status === 'didnotrun');
const blocked = computed(() => props.blockedTests ?? []);
const hasBlocked = computed(() => blocked.value.length > 0);

/** Show the card only when it carries a did-not-run explanation or a blocked-tests list. */
const visible = computed(() => didNotRun.value || hasBlocked.value);

const reasonLabel = computed(() => formatDidNotRunReason(props.reason));

/** Longer explanation for a run-level cutoff (no single blocking test). */
const cutoffDetail = computed(() => {
  switch (props.reason) {
    case 'global-timeout':
      return 'The run hit its global timeout before this test could start, so Playwright stopped launching new tests.';
    case 'max-failures':
      return 'The run reached its configured maximum number of failures and stopped before this test could start.';
    case 'interrupted':
      return 'The run was interrupted (a worker crashed or it was cancelled) before this test could start.';
    default:
      return null;
  }
});
</script>

<template>
  <SectionCard
    v-if="visible"
    icon="i-lucide-circle-slash"
    icon-class="text-amber-500"
    :title="didNotRun ? 'Did not run' : 'Blocked tests'"
  >
    <div class="space-y-4 text-sm">
      <!-- Why this execution never ran -->
      <template v-if="didNotRun">
        <div class="flex items-center gap-2">
          <UBadge color="warning" variant="subtle" size="sm" class="inline-flex items-center gap-1">
            <UIcon name="i-lucide-circle-slash" class="size-3 shrink-0" />
            {{ reasonLabel }}
          </UBadge>
        </div>

        <p v-if="blockedByCase" class="text-gray-600 dark:text-gray-400">
          Skipped after
          <NuxtLink :to="`/test-run-cases/${blockedByCase.id}`" class="text-primary hover:underline font-medium">
            {{ blockedByCase.title }}
          </NuxtLink>
          failed earlier in the same serial group.
        </p>
        <p v-else-if="cutoffDetail" class="text-gray-600 dark:text-gray-400">{{ cutoffDetail }}</p>
        <p v-else-if="reason === 'previous-failure'" class="text-gray-600 dark:text-gray-400">
          Skipped because an earlier step in its serial group failed.
        </p>
      </template>

      <!-- Downstream tests this failure blocked -->
      <div v-if="hasBlocked">
        <p class="text-gray-600 dark:text-gray-400 mb-2">
          This failure stopped
          <strong class="text-gray-800 dark:text-gray-200">{{ blocked.length }}</strong>
          later test{{ blocked.length === 1 ? '' : 's' }} in the same serial group from running:
        </p>
        <ul class="space-y-1">
          <li v-for="t in blocked" :key="t.id" class="flex items-center gap-2 min-w-0">
            <UIcon name="i-lucide-circle-slash" class="size-3.5 shrink-0 text-amber-500" />
            <NuxtLink :to="`/test-run-cases/${t.id}`" class="text-primary hover:underline truncate">
              {{ t.title }}
            </NuxtLink>
          </li>
        </ul>
      </div>
    </div>
  </SectionCard>
</template>
