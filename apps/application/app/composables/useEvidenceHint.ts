import type { MaybeRefOrGetter, ComputedRef } from 'vue';
import type { FailureClue, FailureStory, FailureClueStrength } from '#shared/failure-clues';

/** The default evidence tab hint: which cited section leads, and how strong it is. */
export interface EvidenceHint {
  section: string | null;
  strength: FailureClueStrength | null;
}

/**
 * The evidence opens on the story. Both failure pages derive the same hint for
 * `EvidenceTabs`: the first member clue's cited section and the story's strength,
 * or — when no combination chained the clues — the top clue's section and
 * strength. One home for that rule.
 */
export function useEvidenceHint(
  clues: MaybeRefOrGetter<FailureClue[]>,
  story: MaybeRefOrGetter<FailureStory | null>,
): ComputedRef<EvidenceHint> {
  return computed(() => {
    const clueList = toValue(clues);
    const s = toValue(story);
    const topClue = clueList[0] ?? null;
    if (s) {
      const first = clueList.find((c) => c.id === s.clueIds[0]) ?? topClue;
      return { section: first?.citations?.[0]?.section ?? null, strength: s.strength };
    }
    return { section: topClue?.citations?.[0]?.section ?? null, strength: topClue?.strength ?? null };
  });
}
