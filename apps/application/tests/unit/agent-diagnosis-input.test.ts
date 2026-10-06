import { describe, expect, test } from 'vitest';
import { diagnosisAuthorLabel, isAgentDiagnosis, parseAgentDiagnosis } from '#shared/agent-diagnosis';
import { fixAttemptKey, fixAttemptDetails, parseFixAttempt, sameCommit } from '#shared/fix-attempts';

const DIAGNOSIS = {
  summary: 'A selector changed',
  confidenceScore: 30,
  severity: 'medium',
  affectedArea: null,
  hypotheses: [
    { category: 'test-bug', rootCause: 'The button was renamed', likelihood: 30, evidence: [] },
    { category: 'app-bug', rootCause: 'The button is gone', likelihood: 60, evidence: ['no button in the ARIA'] },
  ],
  suggestedFix: { description: 'Use the new name', file: null, code: null, patch: null },
  investigationSteps: ['Open the trace'],
  preventionTips: [],
};

describe('parseAgentDiagnosis', () => {
  test('normalizes the diagnosis the way a model answer is', () => {
    const parsed = parseAgentDiagnosis({ model: ' claude-opus-5-5 ', diagnosis: DIAGNOSIS });
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.value.model).toBe('claude-opus-5-5');
    // The top hypothesis by likelihood decides the category and the root cause.
    expect(parsed.value.diagnosis.category).toBe('app-bug');
    expect(parsed.value.diagnosis.rootCause).toBe('The button is gone');
    expect(parsed.value.diagnosis.confidence).toBe('low');
  });

  test('refuses an unknown field and an empty hypothesis list, naming them', () => {
    const extra = parseAgentDiagnosis({ model: 'm', diagnosis: { ...DIAGNOSIS, verdict: 'x' } });
    expect(extra.ok).toBe(false);
    const empty = parseAgentDiagnosis({ model: 'm', diagnosis: { ...DIAGNOSIS, hypotheses: [] } });
    expect(!empty.ok && empty.message).toMatch(/diagnosis\.hypotheses/);
  });

  test('labels the author', () => {
    expect(isAgentDiagnosis('agent')).toBe(true);
    expect(diagnosisAuthorLabel('agent', 'claude-opus-5-5')).toBe('Written by an agent (claude-opus-5-5)');
    expect(diagnosisAuthorLabel('anthropic', 'claude-opus-5-5')).toBe('claude-opus-5-5');
    expect(diagnosisAuthorLabel(null, null)).toBe('unknown model');
  });
});

describe('fix attempt bodies', () => {
  test('the same change reported twice has one key; another commit is another attempt', () => {
    const a = parseFixAttempt({ kind: 'patch', commit: 'ABC1234', patch: '--- a\n+++ b\n' });
    const b = parseFixAttempt({ kind: 'patch', commit: 'abc1234', patch: '--- a\r\n+++ b\r\n' });
    const c = parseFixAttempt({ kind: 'patch', commit: 'abc1235', patch: '--- a\n+++ b\n' });
    if (!a.ok || !b.ok || !c.ok) throw new Error('expected valid bodies');
    expect(fixAttemptKey(fixAttemptDetails(a.value))).toBe(fixAttemptKey(fixAttemptDetails(b.value)));
    expect(fixAttemptKey(fixAttemptDetails(a.value))).not.toBe(fixAttemptKey(fixAttemptDetails(c.value)));
    expect(fixAttemptDetails(a.value)).toMatchObject({ commit: 'abc1234', attemptKind: 'patch' });
  });

  test('refuses a commit that is not a SHA', () => {
    const bad = parseFixAttempt({ kind: 'patch', commit: 'main' });
    expect(!bad.ok && bad.message).toMatch(/commit/);
  });

  test('a short SHA matches its full form', () => {
    expect(sameCommit('abc1234', 'abc1234def5678')).toBe(true);
    expect(sameCommit('ABC1234', 'abc1234')).toBe(true);
    expect(sameCommit('abc1235', 'abc1234def')).toBe(false);
    expect(sameCommit(null, 'abc')).toBe(false);
  });
});
