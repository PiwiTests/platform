<script setup lang="ts">
/**
 * The clue list: the deterministic, rule-based findings for one failing
 * execution, ranked strongest first. Each clue carries a strength chip, its
 * `t-N s` before the failure when it is anchored in time, and citation chips
 * that reveal the evidence section backing it — the same section-locator
 * mechanism the AI citations use, so a clue doubles as a jump into the funnel.
 *
 * It is the body of the story line's `more ▸` disclosure: a small heading and
 * the ranked list, with no card wrapper or help hint of its own (the situation
 * block carries the page's one hint).
 *
 * Pure presentation: the clues arrive pre-built from `/clues` (the deterministic
 * `buildFailureClues`); this component only draws them and wires the jumps.
 */
import type { FailureClue, FailureClueStrength } from '#shared/failure-clues';
import { DIAGNOSIS_SECTION_SHORT } from '#shared/diagnosis-sections';
import { useClusterSectionLocator } from '~/composables/useClusterSectionLocator';

const props = defineProps<{
  clues: FailureClue[];
  /** The moment of failure in ms relative to the timeline origin — anchors `t-N s`. */
  failureAt?: number | null;
  /** The disclosure heading — rendered as "{title} (N)". */
  title?: string;
}>();

const locator = useClusterSectionLocator();

const STRENGTH: Record<FailureClueStrength, { label: string; color: 'error' | 'warning' | 'neutral' }> = {
  strong: { label: 'Strong', color: 'error' },
  medium: { label: 'Medium', color: 'warning' },
  weak: { label: 'Weak', color: 'neutral' },
};

/** `t-1.1 s` before the failure, or null when the clue is not anchored in time. */
function leadLabel(clue: FailureClue): string | null {
  if (clue.at == null || props.failureAt == null) return null;
  const lead = props.failureAt - clue.at;
  if (!Number.isFinite(lead) || lead <= 0) return null;
  return `t-${(lead / 1000).toFixed(1)}s`;
}

function citationLabel(section: string): string {
  return DIAGNOSIS_SECTION_SHORT[section] ?? section;
}
</script>

<template>
  <div v-if="clues.length" data-shot="failure-clues" class="space-y-2 rounded-md border border-default p-2.5">
    <p v-if="title" class="text-xs font-medium text-muted">{{ title }} ({{ clues.length }})</p>
    <ul class="space-y-2.5">
      <li
        v-for="clue in clues"
        :key="clue.id"
        class="flex flex-col gap-1 rounded-md border border-default p-2.5 max-sm:p-2 sm:flex-row sm:items-start sm:gap-3"
      >
        <div class="flex shrink-0 items-center gap-1.5">
          <UBadge :color="STRENGTH[clue.strength].color" variant="subtle" size="sm">
            {{ STRENGTH[clue.strength].label }}
          </UBadge>
          <span v-if="leadLabel(clue)" class="font-mono text-xs text-muted tabular-nums">{{ leadLabel(clue) }}</span>
        </div>

        <div class="min-w-0 flex-1 space-y-1">
          <p class="text-sm font-medium text-highlighted">{{ clue.title }}</p>
          <p class="text-xs text-muted">{{ clue.detail }}</p>

          <div v-if="clue.citations.length" class="flex flex-wrap items-center gap-1 pt-0.5">
            <template v-for="(cite, i) in clue.citations" :key="i">
              <UButton
                v-if="locator.canLocate(cite.section)"
                size="xs"
                variant="soft"
                color="neutral"
                icon="i-lucide-arrow-down-to-line"
                :label="citationLabel(cite.section)"
                :title="`Show the ${citationLabel(cite.section)} evidence`"
                @click="locator.open(cite.section)"
              />
              <UBadge v-else size="sm" variant="soft" color="neutral">{{ citationLabel(cite.section) }}</UBadge>
            </template>
          </div>
        </div>
      </li>
    </ul>
  </div>
</template>
