import type { MaybeRefOrGetter, ComputedRef } from 'vue';
import type { FailureClue, FailureClueCitation, FailureStory, FailureClueStrength } from '#shared/failure-clues';
import type { MostLikely } from '#shared/most-likely';

/**
 * What the evidence card reads from the page's explanation: which cited section
 * leads and how strong it is (the default tab), and what the Most likely line
 * cites (the rows and tabs the card marks).
 */
export interface EvidenceHint {
  section: string | null;
  strength: FailureClueStrength | null;
  cited: FailureClueCitation[];
}

/**
 * The evidence opens on the story. Both failure pages derive the same hint for
 * `EvidenceTabs`: the first member clue's cited section and the story's strength,
 * or — when no combination chained the clues — the top clue's section and
 * strength, plus the citations of the Most likely line the page shows. One
 * home for that rule.
 */
export function useEvidenceHint(
  clues: MaybeRefOrGetter<FailureClue[]>,
  story: MaybeRefOrGetter<FailureStory | null>,
  mostLikely: MaybeRefOrGetter<MostLikely | null>,
): ComputedRef<EvidenceHint> {
  return computed(() => {
    const clueList = toValue(clues);
    const s = toValue(story);
    const cited = toValue(mostLikely)?.citations ?? [];
    const topClue = clueList[0] ?? null;
    if (s) {
      const first = clueList.find((c) => c.id === s.clueIds[0]) ?? topClue;
      return { section: first?.citations?.[0]?.section ?? null, strength: s.strength, cited };
    }
    return { section: topClue?.citations?.[0]?.section ?? null, strength: topClue?.strength ?? null, cited };
  });
}
