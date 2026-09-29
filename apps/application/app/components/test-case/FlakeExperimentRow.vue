<script setup lang="ts">
import type { FlakeExperimentRecord } from '#shared/flake-lab';
import { flakeExperimentSentence, flakeVerdictWord } from '~/utils/flake-lab';

/**
 * One Flake Lab experiment as a list item: its sentence, where and when it
 * ran, and each arm's counts. Given a `title`, the item opens with the test,
 * linked to its Flakiness tab, for a list spanning several tests.
 */
const props = defineProps<{
  experiment: FlakeExperimentRecord;
  title?: string | null;
}>();

const e = computed(() => props.experiment);
</script>

<template>
  <li class="px-3 py-2.5 space-y-1" data-testid="flake-experiment" :data-verdict="e.verdict ?? ''">
    <NuxtLink
      v-if="title"
      :to="`/test-cases/${e.testCaseId}?tab=flakiness`"
      class="block text-sm font-semibold text-highlighted hover:underline break-words"
    >
      {{ title }}
    </NuxtLink>
    <p class="text-sm text-highlighted break-words">{{ flakeExperimentSentence(e) }}</p>
    <p class="text-xs text-muted break-words">
      <span v-if="e.commit" class="font-mono">{{ e.commit.slice(0, 7) }}</span>
      <span v-if="e.commit"> · </span>
      <span v-if="e.failureCommit && e.commit && !e.commit.startsWith(e.failureCommit.slice(0, 7))"
        >failures on <span class="font-mono">{{ e.failureCommit.slice(0, 7) }}</span> ·
      </span>
      {{ e.source }}<span v-if="e.machine"> on {{ e.machine }}</span>
      <span v-if="e.playwrightProject"> · {{ e.playwrightProject }}</span>
      <span v-if="e.finishedAt"> · {{ formatRelativeTime(e.finishedAt) }}</span>
    </p>
    <ul class="flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-muted">
      <li v-for="a in e.arms" :key="a.id" class="tabular-nums">
        {{ a.label }} {{ a.matchingFailures }}/{{ a.runs
        }}<span v-if="a.otherFailures"> (+{{ a.otherFailures }} other)</span
        ><span v-if="a.verdict && a.key !== 'control'"> · {{ flakeVerdictWord(a.verdict) }}</span>
      </li>
    </ul>
  </li>
</template>
