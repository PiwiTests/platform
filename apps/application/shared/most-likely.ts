/**
 * The one explanation both failure pages lead with ("Most likely"), and the
 * sentence the Next line says its step comes from. One rule on both pages, so
 * the execution page and its cluster's page explain the same failure the same
 * way:
 *
 * 1. a story graded strong or medium (the chained clues);
 * 2. else the cluster's completed diagnosis;
 * 3. else a weak story;
 * 4. else the top clue in its own words.
 *
 * Pure: no Nuxt imports, shared by the pages, the server and the tests.
 */
import type { FailureClue, FailureClueCitation, FailureClueStrength, FailureStory } from '#shared/failure-clues';
import type { NextStep } from '#shared/next-step';
import type { LocatorHealingResult } from '#shared/locator-healing.types';
import { isAgentDiagnosis } from '#shared/agent-diagnosis';
import { healingSourcePhrase } from '#shared/healing-source';

/** A cluster's completed diagnosis, as the failure pages hold it. */
export interface MostLikelyDiagnosis {
  summary: string;
  confidence?: string | null;
  /** `agent` when an agent wrote it; otherwise the AI provider. */
  provider?: string | null;
}

export interface MostLikely {
  /** What the line shows: the story, the top clue alone, or the cluster's diagnosis. */
  source: 'story' | 'clue' | 'diagnosis';
  sentence: string;
  /** The strength or the confidence, as plain words ("Strong", "Diagnosed, high confidence"). */
  grade: string | null;
  /** How many clues agree with it ("3 clues agree", "supported by 2 clues"), or null. */
  agreeLabel: string | null;
  /** The top clue's citations, shown on the line itself only when the line is that clue alone. */
  inlineCitations: FailureClueCitation[];
}

const STRENGTH: Record<FailureClueStrength, string> = {
  strong: 'Strong',
  medium: 'Medium',
  weak: 'Weak',
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function pickMostLikely(input: {
  story: FailureStory | null | undefined;
  clues: FailureClue[] | null | undefined;
  diagnosis: MostLikelyDiagnosis | null | undefined;
}): MostLikely | null {
  const story = input.story ?? null;
  const clues = input.clues ?? [];
  const diagnosis = input.diagnosis?.summary?.trim() ? input.diagnosis : null;
  const topClue = clues[0] ?? null;

  if (story && story.strength !== 'weak') return fromStory(story);
  if (diagnosis) {
    // The diagnosis reads every clue as evidence: the story's members when one
    // chained them, else all of them.
    const n = story ? story.clueIds.length : clues.length;
    return {
      source: 'diagnosis',
      sentence: diagnosis.summary,
      grade: diagnosis.confidence ? `Diagnosed, ${diagnosis.confidence} confidence` : 'Diagnosed',
      agreeLabel: n > 0 ? `supported by ${plural(n, 'clue')}` : null,
      inlineCitations: [],
    };
  }
  if (story) return fromStory(story);
  if (topClue) {
    // A lone clue that is the sentence itself agrees with nothing, so it states
    // no count; its detail stands alone when it already opens with the title.
    const n = clues.length;
    return {
      source: 'clue',
      sentence: topClue.detail.toLowerCase().startsWith(topClue.title.toLowerCase())
        ? topClue.detail
        : `${topClue.title} — ${topClue.detail}`,
      grade: STRENGTH[topClue.strength],
      agreeLabel: n > 1 ? `${n} clues agree` : null,
      inlineCitations: topClue.citations,
    };
  }
  return null;
}

function fromStory(story: FailureStory): MostLikely {
  const n = story.clueIds.length;
  return {
    source: 'story',
    sentence: story.sentence,
    grade: STRENGTH[story.strength],
    agreeLabel: n > 0 ? `${plural(n, 'clue')} agree${n === 1 ? 's' : ''}` : null,
    inlineCitations: [],
  };
}

/**
 * The meta sentence under the Next line's title that says where its change comes
 * from, or null for a step that copies nothing it did not compute itself.
 *
 * - A step from the diagnosis names it, with its confidence and its summary, when
 *   Most likely shows something else; when Most likely is that diagnosis, it
 *   points up at it in a short form instead of saying the summary twice. The
 *   execution page names the diagnosis as the cluster's.
 * - Following a diagnosis adds why its patch is not the step.
 * - Replacing a locator names locator healing and what its pick comes from.
 */
export function nextStepSourceLine(
  step: Pick<NextStep, 'kind' | 'source'> | null | undefined,
  facts: {
    mostLikely: Pick<MostLikely, 'source'> | null | undefined;
    diagnosis: (MostLikelyDiagnosis & { hasPatch?: boolean | null }) | null | undefined;
    healing?: Pick<LocatorHealingResult, 'source' | 'recommendation'> | null;
    scope: 'execution' | 'cluster';
  },
): string | null {
  if (!step) return null;

  if (step.source === 'healing') {
    const phrase = healingSourcePhrase(
      facts.healing?.source ?? null,
      facts.healing?.recommendation?.recommended?.pickedByUser ?? false,
    );
    return phrase ? `From locator healing, ${phrase}.` : 'From locator healing.';
  }

  if (step.source !== 'diagnosis') return null;
  const diagnosis = facts.diagnosis?.summary?.trim() ? facts.diagnosis : null;
  if (!diagnosis) return null;

  const byAgent = isAgentDiagnosis(diagnosis.provider);
  const confidence = diagnosis.confidence ? `, ${diagnosis.confidence} confidence` : '';
  let line: string;
  if (facts.mostLikely?.source === 'diagnosis') {
    line = `From the ${byAgent ? "agent's" : 'AI'} diagnosis above${confidence}.`;
  } else {
    const who = byAgent
      ? "an agent's diagnosis"
      : facts.scope === 'execution'
        ? "the cluster's AI diagnosis"
        : 'the AI diagnosis';
    const summary = diagnosis.summary.trim();
    line = `From ${who}${confidence}: ${summary}${/[.!?]$/.test(summary) ? '' : '.'}`;
  }
  if (step.kind === 'follow-diagnosis') {
    line +=
      diagnosis.hasPatch === false ? ' It proposes no patch.' : ' Its patch no longer applies to the current code.';
  }
  return line;
}
