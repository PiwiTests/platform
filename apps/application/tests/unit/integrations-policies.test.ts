import { describe, test, expect } from 'vitest';
import {
  buildFixComment,
  buildRegressionComment,
  buildStillFailingComment,
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
    expect(one).toContain('+1 occurrence in 1 runs');
    const many = renderMarkdown(
      buildStillFailingComment('en', { addedOccurrences: 12, runs: 4, latestRun: 100, clusterUrl: null }),
    );
    expect(many).toContain('+12 occurrences in 4 runs');
    expect(many).toContain('run #100');
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
  });

  test('a re-run reuses the same fix key; a different run gets a different one', () => {
    expect(fixCommentKey(42, 1)).toBe(fixCommentKey(42, 1));
    expect(fixCommentKey(42, 1)).not.toBe(fixCommentKey(42, 2));
  });
});
