<script setup lang="ts">
/**
 * Most likely, for a test that did not run: why, in one sentence in the body
 * style (`describeDidNotRun`), the test that blocked it a link in the
 * sentence's color, then one meta line saying where the fact comes from or
 * what a failed `beforeAll` does to its group. No badge and no icon: the
 * status chip already says it did not run.
 */
import type { DidNotRunExplanation } from '#shared/did-not-run';

defineProps<{ explanation: DidNotRunExplanation }>();
</script>

<template>
  <div data-shot="most-likely" data-most-likely="did-not-run" class="space-y-1">
    <p><SituationParts :parts="explanation.parts" /></p>
    <p v-if="explanation.note" class="text-xs text-muted">{{ explanation.note }}</p>
  </div>
</template>
