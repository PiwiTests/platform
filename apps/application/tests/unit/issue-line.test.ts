import { describe, test, expect } from 'vitest';
import { issueLineForm, type IssueLineFacts } from '../../app/utils/issue-line';

const facts = (over: Partial<IssueLineFacts> = {}): IssueLineFacts => ({
  hasKnownIssue: false,
  filingQueued: false,
  clusterStatus: 'open',
  snoozed: false,
  canFile: true,
  canLink: true,
  ...over,
});

describe('issueLineForm', () => {
  test('a tracked cluster always shows its issue, whatever its status or the viewer', () => {
    expect(issueLineForm(facts({ hasKnownIssue: true }))).toBe('tracked');
    expect(
      issueLineForm(facts({ hasKnownIssue: true, clusterStatus: 'ignored', canFile: false, canLink: false })),
    ).toBe('tracked');
  });

  test('a filing waiting on the tracker shows as queued', () => {
    expect(issueLineForm(facts({ filingQueued: true }))).toBe('queued');
  });

  test('an untracked open cluster offers to file or link to a viewer who can', () => {
    expect(issueLineForm(facts())).toBe('untracked');
    expect(issueLineForm(facts({ canFile: false }))).toBe('untracked');
    expect(issueLineForm(facts({ canFile: false, canLink: false }))).toBeNull();
  });

  test('an ignored, resolved or snoozed cluster asks for no ticket', () => {
    expect(issueLineForm(facts({ clusterStatus: 'ignored' }))).toBeNull();
    expect(issueLineForm(facts({ clusterStatus: 'resolved' }))).toBeNull();
    expect(issueLineForm(facts({ snoozed: true }))).toBeNull();
  });
});
