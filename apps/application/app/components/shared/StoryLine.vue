<script setup lang="ts">
/**
 * "Most likely" — the one explanation of a failure on the first screen. It leads
 * with the story sentence (the chained clues), or the top clue alone when no
 * combination matched, or the cluster's diagnosis summary when one completed.
 * Under the sentence, one meta line grades it (strength or confidence), says how
 * many clues agree, and opens the disclosure that lists every clue with its
 * citations. The word "clue" appears only on that meta line and inside the
 * disclosure. The block that renders this line provides its label.
 */
import type { FailureClue, FailureClueStrength, FailureStory } from '#shared/failure-clues';
import { DIAGNOSIS_SECTION_SHORT } from '#shared/diagnosis-sections';
import { useClusterSectionLocator } from '~/composables/useClusterSectionLocator';

const props = defineProps<{
  story: FailureStory | null;
  clues: FailureClue[];
  /** The moment of failure in ms relative to the timeline origin — anchors `t-N s`. */
  failureAt?: number | null;
  /** When the cluster has a completed diagnosis, it leads the line. */
  diagnosis?: { summary: string; confidence?: string | null } | null;
}>();

const locator = useClusterSectionLocator();

const STRENGTH: Record<FailureClueStrength, string> = {
  strong: 'Strong',
  medium: 'Medium',
  weak: 'Weak',
};

const topClue = computed(() => props.clues[0] ?? null);

// The sentence: the diagnosis leads when it completed, else the story, else the
// top clue in its own words.
const sentence = computed(() => {
  if (props.diagnosis) return props.diagnosis.summary;
  if (props.story) return props.story.sentence;
  const c = topClue.value;
  return c ? `${c.title} — ${c.detail}` : '';
});

// A clue detail may quote a locator in backticks; those spans render as code.
const sentenceParts = computed(() =>
  sentence.value
    .split(/(`[^`]+`)/)
    .filter(Boolean)
    .map((text) => (text.startsWith('`') ? { code: true, text: text.slice(1, -1) } : { code: false, text })),
);

// The grade of the explanation, as plain words.
const grade = computed<string | null>(() => {
  if (props.diagnosis) {
    const c = props.diagnosis.confidence;
    return c ? `Diagnosed, ${c} confidence` : 'Diagnosed';
  }
  const strength = props.story?.strength ?? topClue.value?.strength ?? null;
  return strength ? STRENGTH[strength] : null;
});

// How many clues agree with the explanation.
const agreeCount = computed(() => {
  if (props.story) return props.story.clueIds.length;
  return props.clues.length;
});
const agreeLabel = computed(() => {
  const n = agreeCount.value;
  if (n <= 0) return null;
  if (props.diagnosis) return `supported by ${n} clue${n === 1 ? '' : 's'}`;
  return `${n} clue${n === 1 ? '' : 's'} agree${n === 1 ? 's' : ''}`;
});

// The top clue's citations show inline only when the line is a bare top clue (no
// story, no diagnosis) — otherwise every clue's citations live in the disclosure.
const inlineCitations = computed(() =>
  !props.diagnosis && !props.story && topClue.value ? topClue.value.citations : [],
);

const open = ref(false);
const hasDisclosure = computed(() => props.clues.length > 0);

function citationLabel(section: string): string {
  return DIAGNOSIS_SECTION_SHORT[section] ?? section;
}
</script>

<template>
  <div v-if="sentence" class="space-y-1">
    <p>
      <template v-for="(part, i) in sentenceParts" :key="i">
        <code v-if="part.code" class="font-mono text-[0.92em]">{{ part.text }}</code>
        <template v-else>{{ part.text }}</template>
      </template>
    </p>
    <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
      <span v-if="grade">{{ grade }}</span>
      <span v-if="grade && agreeLabel" aria-hidden="true">·</span>
      <span v-if="agreeLabel">{{ agreeLabel }}</span>

      <!-- inline citations, only for a bare top clue -->
      <template v-for="(cite, i) in inlineCitations" :key="`inline-${i}`">
        <UButton
          v-if="locator.canLocate(cite.section)"
          size="xs"
          variant="outline"
          color="neutral"
          :label="citationLabel(cite.section)"
          :title="`Show the ${citationLabel(cite.section)} evidence`"
          @click="locator.open(cite.section)"
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
