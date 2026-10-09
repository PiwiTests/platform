<script setup lang="ts">
/**
 * The meta line under a failing execution's headline: why and since when it
 * fails (for a pass that needed a retry, which attempt failed, linked to it),
 * on which commit and author, then whether it is the latest execution of
 * its test, with one link to the newest one when it is not. One meta style; the
 * commit sits in a code chip. Below `sm` the latest part starts its own line, so
 * "Not the latest" reads as a fact of its own on a phone; the link wraps with
 * its separator.
 */
import type { SituationLine } from '#shared/situation';

const props = defineProps<{
  since: SituationLine;
  latest: SituationLine | null;
  /** The run's repository, for the commit's link. */
  repositoryUrl?: string | null;
}>();

const latestSentence = computed(() => props.latest?.parts.filter((p) => p.kind !== 'execution') ?? []);
const latestLink = computed(() => props.latest?.parts.filter((p) => p.kind === 'execution') ?? []);
</script>

<template>
  <p data-shot="execution-meta" class="mt-1 text-xs text-muted">
    <span data-testid="execution-meta-since"
      ><SituationParts :parts="since.parts" :repository-url="repositoryUrl" /></span
    ><template v-if="latest"
      ><span aria-hidden="true" class="max-sm:hidden"> · </span
      ><span data-testid="execution-meta-latest" class="max-sm:block max-sm:mt-0.5"
        ><SituationParts :parts="latestSentence" /><template v-if="latestLink.length"
          >{{ ' '
          }}<span class="whitespace-nowrap"
            ><span aria-hidden="true">· </span><SituationParts :parts="latestLink" /></span></template></span
    ></template>
  </p>
</template>
