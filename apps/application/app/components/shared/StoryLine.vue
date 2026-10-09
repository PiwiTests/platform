<script setup lang="ts">
/**
 * "Most likely" — the one explanation of a failure on the first screen, as
 * `pickMostLikely` chose it: a strong or medium story (the chained clues), else
 * the cluster's completed diagnosis, else a weak story, else the top clue alone.
 * Under the sentence, one meta line grades it (strength or confidence), says how
 * many clues agree, and opens the disclosure that lists every clue with its
 * citations. The word "clue" appears only on that meta line and inside the
 * disclosure. The block that renders this line provides its label.
 */
import type { FailureClue } from '#shared/failure-clues';
import type { MostLikely } from '#shared/most-likely';
import { DIAGNOSIS_SECTION_SHORT } from '#shared/diagnosis-sections';
import { useClusterSectionLocator } from '~/composables/useClusterSectionLocator';

const props = defineProps<{
  mostLikely: MostLikely;
  /** Every clue of the execution, for the disclosure. */
  clues: FailureClue[];
  /** The moment of failure in ms relative to the timeline origin — anchors `t-N s`. */
  failureAt?: number | null;
}>();

const locator = useClusterSectionLocator();

// A clue detail may quote a locator in backticks; those spans render as code.
const sentenceParts = computed(() =>
  props.mostLikely.sentence
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((text) => (text.startsWith('`') ? { code: true, text: text.slice(1, -1) } : { code: false, text })),
);

const open = ref(false);
const hasDisclosure = computed(() => props.clues.length > 0);

function citationLabel(section: string): string {
  return DIAGNOSIS_SECTION_SHORT[section] ?? section;
}
</script>

<template>
  <div data-shot="most-likely" :data-most-likely="mostLikely.source" class="space-y-1">
    <p>
      <template v-for="(part, i) in sentenceParts" :key="i">
        <code v-if="part.code" class="font-mono text-[0.92em]">{{ part.text }}</code>
        <template v-else>{{ part.text }}</template>
      </template>
    </p>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span v-if="mostLikely.grade">{{ mostLikely.grade }}</span>
      <span v-if="mostLikely.grade && mostLikely.agreeLabel" aria-hidden="true">·</span>
      <span v-if="mostLikely.agreeLabel">{{ mostLikely.agreeLabel }}</span>

      <!-- inline citations, only for a bare top clue -->
      <template v-for="(cite, i) in mostLikely.inlineCitations" :key="`inline-${i}`">
        <UButton
          v-if="locator.canLocate(cite.section)"
          size="xs"
          variant="outline"
          color="neutral"
          :label="citationLabel(cite.section)"
          :title="`Show the ${citationLabel(cite.section)} evidence`"
          @click="locator.open(cite.section, cite.index)"
        />
        <span v-else>{{ citationLabel(cite.section) }}</span>
      </template>

      <UButton
        v-if="hasDisclosure"
        size="xs"
        variant="ghost"
        color="neutral"
        :trailing-icon="open ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
        :aria-expanded="open"
        @click="open = !open"
      >
        All clues
      </UButton>
    </div>

    <CluesCard v-if="open && hasDisclosure" :clues="clues" :failure-at="failureAt" title="All clues" />
  </div>
</template>
