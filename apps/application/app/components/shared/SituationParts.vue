<script setup lang="ts">
/**
 * The parts of one situation line, inline in the sentence that holds them: a
 * part with an href is a link in the sentence's color, a commit is a code chip
 * that links to the SCM host when the run names a repository, anything else is
 * plain text. The line's style is its container's: the meta line under an
 * execution's headline, the body of the block's Cluster line.
 */
import type { SituationPart } from '#shared/situation';
import { commitUrl } from '#shared/scm-urls';

const props = defineProps<{
  parts: SituationPart[];
  /** The run's repository, for a commit's link; a commit without one is a plain chip. */
  repositoryUrl?: string | null;
}>();

function commitHref(part: SituationPart): string | null {
  return part.id != null ? commitUrl(props.repositoryUrl ?? null, String(part.id)) : null;
}
</script>

<template>
  <template v-for="(part, i) in parts" :key="i"
    ><NuxtLink
      v-if="part.href"
      :to="part.href"
      :class="[
        SENTENCE_LINK_CLASS,
        part.kind === 'commit' ? CODE_CHIP_CLASS : '',
        part.kind === 'execution' ? 'whitespace-nowrap' : '',
      ]"
      >{{ part.text }}</NuxtLink
    ><a
      v-else-if="part.kind === 'commit' && commitHref(part)"
      :href="commitHref(part)!"
      target="_blank"
      rel="noopener"
      :class="[SENTENCE_LINK_CLASS, CODE_CHIP_CLASS]"
      >{{ part.text }}</a
    ><span v-else-if="part.kind === 'commit'" :class="CODE_CHIP_CLASS">{{ part.text }}</span
    ><template v-else>{{ part.text }}</template></template
  >
</template>
