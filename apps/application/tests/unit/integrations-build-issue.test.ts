import { describe, test, expect } from 'vitest';
import { buildIssue, issueLabels, type IssueFacts } from '../../shared/integrations/build-issue';
import { renderMarkdown } from '../../shared/integrations/render-markdown';

function facts(overrides: Partial<IssueFacts> = {}): IssueFacts {
  return {
    clusterId: 42,
    fingerprint: 'abcdef1234567890',
    title: 'Timeout on checkout',
    headline: 'page.click timed out',
    errorType: 'timeout',
    firstSeen: '1 Jan 2026, 00:00 UTC',
    lastSeen: '2 Jan 2026, 00:00 UTC',
    occurrences: 5,
    affectedTests: [{ title: 'checks out', filePath: 'checkout.spec.ts', owner: '@acme/checkout' }],
    branch: 'main',
    environment: 'staging',
    commit: 'abc123def456',
    diagnosisSummary: 'The button moved.',
    rootCause: 'A refactor renamed the selector.',
    clue: 'Timed out waiting for the app',
    errorExcerpt: 'TimeoutError: locator.click',
    failingLocator: "getByRole('button')",
    patch: '--- a\n+++ b',
    locatorEdits: [{ filePath: 'checkout.spec.ts', line: 12, failingLocator: 'a', suggestedLocator: 'b' }],
    verifyCommand: 'npx playwright test checkout.spec.ts',
    reproduceScript: 'git clone …',
    clusterUrl: 'https://piwi.test/failure-clusters/42',
    executionUrl: 'https://piwi.test/test-run-cases/9',
    runUrl: 'https://piwi.test/test-runs/3',
    shareUrl: null,
    ...overrides,
  };
}

describe('issueLabels', () => {
  test('always carries piwi, cluster and fingerprint labels', () => {
    expect(issueLabels(42, 'abcdef1234567890')).toEqual(['piwi', 'piwi-cluster-42', 'piwi-fp-abcdef12']);
  });
});

describe('buildIssue', () => {
  test('renders every section and ends with the trailer', () => {
    const md = renderMarkdown(buildIssue(facts()).document);
    expect(md).toContain('## What happened');
    expect(md).toContain('## Most likely');
    expect(md).toContain('## Evidence');
    expect(md).toContain('## What to do');
    expect(md).toContain('## Links');
    expect(md).toContain('Piwi-Cluster: 42');
    expect(md).toContain('The button moved.');
    expect(md).toContain('Root cause:');
    expect(md).toContain('A refactor renamed the selector.');
  });

  test('include toggles drop the diagnosis and patch', () => {
    const md = renderMarkdown(buildIssue(facts(), { includeDiagnosis: false, includePatch: false }).document);
    expect(md).not.toContain('The button moved.');
    expect(md).not.toContain('```diff');
    // With no diagnosis, the clue takes over "Most likely".
    expect(md).toContain('Timed out waiting for the app');
  });

  test('sections degrade independently when facts are missing', () => {
    const md = renderMarkdown(
      buildIssue(
        facts({
          diagnosisSummary: null,
          rootCause: null,
          clue: null,
          errorExcerpt: null,
          failingLocator: null,
          patch: null,
          locatorEdits: [],
          verifyCommand: null,
          reproduceScript: null,
        }),
      ).document,
    );
    expect(md).not.toContain('## Most likely');
    expect(md).not.toContain('## Evidence');
    expect(md).not.toContain('## What to do');
    // What happened and Links still render.
    expect(md).toContain('## What happened');
    expect(md).toContain('## Links');
  });

  test('the share link only appears when the toggle is on and a url exists', () => {
    const off = renderMarkdown(buildIssue(facts({ shareUrl: 'https://piwi.test/share/x' })).document);
    expect(off).not.toContain('/share/x');
    const on = renderMarkdown(
      buildIssue(facts({ shareUrl: 'https://piwi.test/share/x' }), { includeShareLink: true }).document,
    );
    expect(on).toContain('/share/x');
  });
});
