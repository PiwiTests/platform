import { describe, test, expect } from 'vitest';
import {
  buildFixComment,
  buildRegressionComment,
  buildStillFailingComment,
  buildDiagnosisComment,
  buildMergeComment,
} from '../../shared/integrations/policy-comments';
import { renderMarkdown } from '../../shared/integrations/render-markdown';
import {
  createIssueKey,
  fixCommentKey,
  fixTransitionKey,
  regressionCommentKey,
  reopenTransitionKey,
  occurrencesCommentKey,
  mergeCommentKey,
  diagnosisCommentKey,
  updateIssueKey,
  dailyUpdateReason,
} from '../../shared/integrations/action-keys';

describe('policy comment builders', () => {
  test('fix comment names the run, short commit and verdict, with a dashboard link', () => {
    const md = renderMarkdown(
      buildFixComment('en', {
        runNumber: 1234,
        commit: 'abc123def456789',
        verification: 'diagnosis-verified',
        clusterUrl: 'https://piwi.example.com/failure-clusters/42',
      }),
    );
    expect(md).toContain('run #1234');
    expect(md).toContain('abc123def456'); // 12-char short sha
    expect(md).not.toContain('abc123def456789'); // full sha trimmed
    expect(md).toContain('diagnosis-verified');
    expect(md).toContain('every affected test passed');
    expect(md).toContain('https://piwi.example.com/failure-clusters/42');
  });

  test('fix comment degrades without a commit and without a site URL', () => {
    const md = renderMarkdown(
      buildFixComment('en', { runNumber: 7, commit: null, verification: 'stopped-failing', clusterUrl: null }),
    );
    expect(md).toContain('run #7');
    expect(md).toContain('stopped failing');
    expect(md).not.toContain('commit');
    expect(md).not.toContain('Open in Piwi');
  });

  test('the fix comment is French through the catalog, no English literal', () => {
    const md = renderMarkdown(
      buildFixComment('fr', { runNumber: 9, commit: null, verification: 'diagnosis-verified', clusterUrl: null }),
    );
    expect(md).toContain('Correctif appliqué');
    expect(md).toContain('diagnostic vérifié');
    expect(md).not.toContain('Fix landed');
  });

  test('regression comment', () => {
    expect(renderMarkdown(buildRegressionComment('en', { runNumber: 5, clusterUrl: null }))).toContain(
      'Regressed in run #5',
    );
    expect(renderMarkdown(buildRegressionComment('fr', { runNumber: 5, clusterUrl: null }))).toContain(
      'Régression dans la série #5',
    );
  });

  test('still-failing comment pluralizes occurrences and reports runs + latest', () => {
    const one = renderMarkdown(
      buildStillFailingComment('en', { addedOccurrences: 1, runs: 1, latestRun: 100, clusterUrl: null }),
    );
    expect(one).toContain('+1 occurrence in 1 run since');
    const many = renderMarkdown(
      buildStillFailingComment('en', { addedOccurrences: 12, runs: 4, latestRun: 100, clusterUrl: null }),
    );
    expect(many).toContain('+12 occurrences in 4 runs');
    expect(many).toContain('run #100');
  });

  test('still-failing comment says where it last failed and what is new since the last note', () => {
    const md = renderMarkdown(
      buildStillFailingComment('en', {
        addedOccurrences: 9,
        runs: 3,
        latestRun: 120,
        latestBranch: 'main',
        latestEnvironment: 'staging',
        newTests: ['a', 'b', 'c', 'd', 'e', 'f', 'g'],
        newBranches: ['release/2.0'],
        newEnvironments: ['prod', 'preprod'],
        clusterUrl: null,
      }),
    );
    expect(md).toContain(
      '+9 occurrences in 3 runs since the last note, latest run #120. Latest failure on main (staging).',
    );
    expect(md).toContain('Now failing on a new branch: release/2.0.');
    expect(md).toContain('Now failing in new environments: prod, preprod.');
    expect(md).toContain('Now also failing in 7 more tests:');
    // Five titles are listed, the rest counted.
    expect(md).toContain('- e');
    expect(md).not.toContain('- f');
    expect(md).toContain('…and 2 more tests.');
  });

  test('still-failing comment in French', () => {
    const md = renderMarkdown(
      buildStillFailingComment('fr', {
        addedOccurrences: 2,
        runs: 1,
        latestRun: 7,
        latestBranch: null,
        latestEnvironment: 'staging',
        clusterUrl: null,
      }),
    );
    expect(md).toContain('+2 occurrences sur 1 série depuis la dernière note');
    expect(md).toContain('Dernier échec dans l’environnement staging.');
  });

  test('diagnosis comment carries the summary, root cause and category', () => {
    const md = renderMarkdown(
      buildDiagnosisComment('en', {
        summary: 'The button was renamed.',
        rootCause: 'A refactor renamed Pay to Checkout.',
        category: 'test-bug',
        confidence: 'high',
        clusterUrl: 'https://piwi.test/failure-clusters/4',
      }),
    );
    expect(md).toContain('**Piwi diagnosed this failure:** The button was renamed.');
    expect(md).toContain('**Root cause:** A refactor renamed Pay to Checkout.');
    expect(md).toContain('**Category:** Test bug (high confidence)');
    expect(md).toContain('[Open in Piwi](https://piwi.test/failure-clusters/4)');
    const fr = renderMarkdown(
      buildDiagnosisComment('fr', {
        summary: null,
        rootCause: null,
        category: 'nonsense',
        confidence: null,
        clusterUrl: null,
      }),
    );
    expect(fr).toBe('**Diagnostic de Piwi :**\n');
  });

  test('merge comment points each way', () => {
    expect(
      renderMarkdown(buildMergeComment('en', { direction: 'into', otherKey: 'PROJ-124', clusterUrl: null })),
    ).toContain('merged into PROJ-124');
    expect(
      renderMarkdown(buildMergeComment('en', { direction: 'absorbed', otherKey: 'PROJ-123', clusterUrl: null })),
    ).toContain('Absorbed PROJ-123');
  });
});

describe('action dedupe keys', () => {
  test('are stable and distinct per policy', () => {
    expect(createIssueKey('failure_cluster', 42, 7)).toBe('create-issue:failure_cluster:42:conn7');
    expect(fixCommentKey(42, 1234)).toBe('comment:failure_cluster:42:fixed:r1234');
    expect(fixTransitionKey(42, 1234)).toBe('transition:failure_cluster:42:fixed:r1234');
    expect(regressionCommentKey(42, 1234)).toBe('comment:failure_cluster:42:regressed:r1234');
    expect(reopenTransitionKey(42, 1234)).toBe('transition:failure_cluster:42:reopen:r1234');
    expect(occurrencesCommentKey(42, '2026-09-13')).toBe('comment:failure_cluster:42:occurrences:2026-09-13');
    expect(mergeCommentKey(42, 124)).toBe('comment:failure_cluster:42:merge:124');
    expect(occurrencesCommentKey(42, '2026-W41')).toBe('comment:failure_cluster:42:occurrences:2026-W41');
    expect(diagnosisCommentKey(42, 1700000000000)).toBe('comment:failure_cluster:42:diagnosis:1700000000000');
    expect(updateIssueKey(42, dailyUpdateReason(new Date(Date.UTC(2026, 9, 8, 23))))).toBe(
      'update-issue:failure_cluster:42:day:2026-10-08',
    );
  });

  test('a re-run reuses the same fix key; a different run gets a different one', () => {
    expect(fixCommentKey(42, 1)).toBe(fixCommentKey(42, 1));
    expect(fixCommentKey(42, 1)).not.toBe(fixCommentKey(42, 2));
  });
});
