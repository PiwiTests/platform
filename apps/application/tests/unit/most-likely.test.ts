import { describe, test, expect } from 'vitest';
import type { FailureClue, FailureStory } from '#shared/failure-clues';
import { pickMostLikely, nextStepSourceLine, type MostLikelyDiagnosis } from '#shared/most-likely';
import { computeNextStep } from '#shared/next-step';

const clue = (overrides: Partial<FailureClue> = {}): FailureClue => ({
  id: 'element-present-but-blocked',
  rule: 'element-present-but-blocked',
  strength: 'strong',
  title: 'The element is present but disabled',
  detail: 'The button "Pay" resolved but stayed disabled.',
  citations: [{ section: 'aria' }],
  ...overrides,
});

const story = (strength: FailureStory['strength'], clueIds = ['a', 'b', 'c']): FailureStory => ({
  id: 'blocked-by-pending-request',
  sentence: 'The button "Pay" stayed disabled because POST /api/checkout/quote was still in flight (28.4 s).',
  clueIds,
  strength,
});

const diagnosis: MostLikelyDiagnosis = {
  summary: 'The payment form renders slowly on CI and the click races the render.',
  confidence: 'high',
};

const clues = [clue(), clue({ id: 'b', strength: 'medium' }), clue({ id: 'c', strength: 'weak' })];

describe('pickMostLikely — one rule on both failure pages', () => {
  test.each([
    ['a strong story beats a high-confidence diagnosis', story('strong'), clues, diagnosis, 'story'],
    ['a medium story beats a diagnosis', story('medium'), clues, diagnosis, 'story'],
    ['a diagnosis beats a weak story', story('weak'), clues, diagnosis, 'diagnosis'],
    ['a diagnosis beats a strong clue standing alone', null, [clue()], diagnosis, 'diagnosis'],
    ['a story alone leads', story('weak'), clues, null, 'story'],
    ['a lone clue leads when nothing else exists', null, [clue()], null, 'clue'],
  ] as const)('%s', (_name, s, c, d, source) => {
    expect(pickMostLikely({ story: s, clues: [...c], diagnosis: d })?.source).toBe(source);
  });

  test('nothing to say: null', () => {
    expect(pickMostLikely({ story: null, clues: [], diagnosis: null })).toBeNull();
    // A diagnosis without a summary says nothing either.
    expect(pickMostLikely({ story: null, clues: [], diagnosis: { summary: '  ', confidence: 'high' } })).toBeNull();
  });

  test('a story is graded by its strength and counts the clues it chains', () => {
    const m = pickMostLikely({ story: story('strong'), clues, diagnosis })!;
    expect(m.sentence).toContain('stayed disabled because POST /api/checkout/quote');
    expect(m.grade).toBe('Strong');
    expect(m.agreeLabel).toBe('3 clues agree');
    expect(m.inlineCitations).toEqual([]);
    expect(pickMostLikely({ story: story('medium', ['a']), clues, diagnosis: null })!.agreeLabel).toBe('1 clue agrees');
  });

  test('a diagnosis is graded by its confidence and counts the clues that support it', () => {
    const m = pickMostLikely({ story: story('weak', ['a', 'b']), clues, diagnosis })!;
    expect(m.sentence).toBe(diagnosis.summary);
    expect(m.grade).toBe('Diagnosed, high confidence');
    expect(m.agreeLabel).toBe('supported by 2 clues');
    const bare = pickMostLikely({ story: null, clues: [clue()], diagnosis: { summary: 'x', confidence: null } })!;
    expect(bare.grade).toBe('Diagnosed');
    expect(bare.agreeLabel).toBe('supported by 1 clue');
    expect(pickMostLikely({ story: null, clues: [], diagnosis })!.agreeLabel).toBeNull();
  });

  test('a lone clue speaks in its own words, cites inline and states no count of itself', () => {
    const m = pickMostLikely({ story: null, clues: [clue()], diagnosis: null })!;
    expect(m.sentence).toBe('The element is present but disabled — The button "Pay" resolved but stayed disabled.');
    expect(m.grade).toBe('Strong');
    expect(m.agreeLabel).toBeNull();
    expect(m.inlineCitations).toEqual([{ section: 'aria' }]);
    expect(pickMostLikely({ story: null, clues, diagnosis: null })!.agreeLabel).toBe('3 clues agree');
  });

  test('cites what its story’s clues cite, what a lone clue cites, and no row for a diagnosis', () => {
    const chained = [
      clue({ id: 'blocked', citations: [{ section: 'ariaSnapshot' }, { section: 'executionError' }] }),
      clue({ id: 'slow', strength: 'medium', citations: [{ section: 'networkRequests', index: 3 }] }),
      clue({ id: 'console', strength: 'medium', citations: [{ section: 'console', index: 0 }] }),
      clue({ id: 'other', strength: 'weak', citations: [{ section: 'steps' }] }),
    ];
    const s = story('strong', ['blocked', 'slow', 'console']);
    expect(pickMostLikely({ story: s, clues: chained, diagnosis })!.citations).toEqual([
      { section: 'ariaSnapshot' },
      { section: 'executionError' },
      { section: 'networkRequests', index: 3 },
      { section: 'console', index: 0 },
    ]);
    expect(pickMostLikely({ story: null, clues: [chained[1]!], diagnosis: null })!.citations).toEqual([
      { section: 'networkRequests', index: 3 },
    ]);
    expect(pickMostLikely({ story: story('weak', ['slow']), clues: chained, diagnosis })!.citations).toEqual([]);
  });

  test('a lone clue whose detail opens with its title is its detail alone', () => {
    const c = clue({ title: 'POST /auth/login returned 500', detail: 'POST /auth/login returned 500 at t-0.4 s.' });
    expect(pickMostLikely({ story: null, clues: [c], diagnosis: null })!.sentence).toBe(
      'POST /auth/login returned 500 at t-0.4 s.',
    );
  });
});

describe('nextStepSourceLine — where the Next step comes from', () => {
  const applyPatch = computeNextStep({ diagnosisCompleted: true, patchAppliesCleanly: true, clusterId: 1 });
  const followDiagnosis = computeNextStep({ diagnosisCompleted: true, clusterId: 1 });
  const replaceLocator = computeNextStep({ hasHealingRecommendation: true, executionId: 2 });
  const storyLeads = { source: 'story' as const };
  const diagnosisLeads = { source: 'diagnosis' as const };

  test('the execution page names the cluster’s AI diagnosis, its confidence and its summary', () => {
    expect(nextStepSourceLine(applyPatch, { mostLikely: storyLeads, diagnosis, scope: 'execution' })).toBe(
      "From the cluster's AI diagnosis, high confidence: The payment form renders slowly on CI and the click races the render.",
    );
  });

  test('the cluster page names the AI diagnosis', () => {
    expect(nextStepSourceLine(applyPatch, { mostLikely: storyLeads, diagnosis, scope: 'cluster' })).toBe(
      'From the AI diagnosis, high confidence: The payment form renders slowly on CI and the click races the render.',
    );
  });

  test('an agent’s diagnosis is named as such', () => {
    const byAgent = { ...diagnosis, provider: 'agent' };
    expect(nextStepSourceLine(applyPatch, { mostLikely: storyLeads, diagnosis: byAgent, scope: 'execution' })).toMatch(
      /^From an agent's diagnosis, high confidence: /,
    );
    expect(nextStepSourceLine(applyPatch, { mostLikely: diagnosisLeads, diagnosis: byAgent, scope: 'cluster' })).toBe(
      "From the agent's diagnosis above, high confidence.",
    );
  });

  test('no confidence: no confidence clause, and a summary without a period gets one', () => {
    expect(
      nextStepSourceLine(applyPatch, {
        mostLikely: storyLeads,
        diagnosis: { summary: 'A race on render', confidence: null },
        scope: 'execution',
      }),
    ).toBe("From the cluster's AI diagnosis: A race on render.");
  });

  test('when Most likely already shows the diagnosis, the short form points up at it', () => {
    expect(nextStepSourceLine(applyPatch, { mostLikely: diagnosisLeads, diagnosis, scope: 'execution' })).toBe(
      'From the AI diagnosis above, high confidence.',
    );
    expect(
      nextStepSourceLine(applyPatch, {
        mostLikely: diagnosisLeads,
        diagnosis: { ...diagnosis, confidence: null },
        scope: 'cluster',
      }),
    ).toBe('From the AI diagnosis above.');
  });

  test.each([
    [{ hasPatch: true, patchStatus: 'stale-file' }, ' Its patch no longer applies to the current code.'],
    [{ hasPatch: true, patchStatus: 'invalid' }, ' Its patch is not a valid diff.'],
    [{ hasPatch: true, patchStatus: 'unchecked' }, ' Its patch could not be checked against the code.'],
    [{ hasPatch: true, patchStatus: null }, ' Its patch could not be checked against the code.'],
    [{ hasPatch: false, patchStatus: null }, ' It proposes no patch.'],
    [{ hasPatch: null, patchStatus: null }, ''],
  ] as const)('following the diagnosis says why its patch is not the step (%o)', (facts, suffix) => {
    expect(
      nextStepSourceLine(followDiagnosis, {
        mostLikely: diagnosisLeads,
        diagnosis: { ...diagnosis, ...facts },
        scope: 'cluster',
      }),
    ).toBe(`From the AI diagnosis above, high confidence.${suffix}`);
  });

  test('the full form ends with why the patch is not the step', () => {
    expect(
      nextStepSourceLine(followDiagnosis, {
        mostLikely: storyLeads,
        diagnosis: { ...diagnosis, hasPatch: false },
        scope: 'execution',
      }),
    ).toMatch(/races the render\. It proposes no patch\.$/);
  });

  test.each([
    ['prior-run', false, 'From locator healing, captured in the last passing run.'],
    ['diff-rename', false, 'From locator healing, taken from the rename in this change.'],
    ['aria-snapshot', false, 'From locator healing, read from the failure-time ARIA snapshot.'],
    ['element-match', true, 'From locator healing, confirmed by hand in the locator picker.'],
    ['none', false, 'From locator healing.'],
  ] as const)('a locator replacement names healing and its %s source', (source, pickedByUser, line) => {
    const healing = {
      source,
      recommendation: { recommended: { locator: 'x', method: 'getByRole', args: {}, score: 90, pickedByUser } },
    } as unknown as Parameters<typeof nextStepSourceLine>[1]['healing'];
    expect(
      nextStepSourceLine(replaceLocator, { mostLikely: diagnosisLeads, diagnosis, healing, scope: 'cluster' }),
    ).toBe(line);
  });

  test('a step that copies nothing from another analysis has no source line', () => {
    for (const s of [
      computeNextStep({}),
      computeNextStep({ aiConfigured: true }),
      computeNextStep({ fixVerification: 'regressed' }),
      computeNextStep({ status: 'didnotrun', blockedByCase: { id: 1 } }),
    ]) {
      expect(nextStepSourceLine(s, { mostLikely: storyLeads, diagnosis, scope: 'execution' })).toBeNull();
    }
    expect(nextStepSourceLine(null, { mostLikely: storyLeads, diagnosis, scope: 'execution' })).toBeNull();
  });

  test('a diagnosis step with no diagnosis loaded has no source line', () => {
    expect(nextStepSourceLine(applyPatch, { mostLikely: storyLeads, diagnosis: null, scope: 'execution' })).toBeNull();
  });
});
