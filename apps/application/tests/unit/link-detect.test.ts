import { describe, test, expect } from 'vitest';
import { detectProvider, extractKey, getProviderIcon } from '#shared/link-detect';

describe('detectProvider', () => {
  test('detects jira (atlassian browse)', () => {
    expect(detectProvider('https://myco.atlassian.net/browse/PROJ-123')).toBe('jira');
  });

  test('detects github-issue', () => {
    expect(detectProvider('https://github.com/owner/repo/issues/42')).toBe('github-issue');
  });

  test('detects github-pr', () => {
    expect(detectProvider('https://github.com/owner/repo/pull/7')).toBe('github-pr');
  });

  test('detects gitlab-issue', () => {
    expect(detectProvider('https://gitlab.com/group/project/-/issues/5')).toBe('gitlab-issue');
  });

  test('detects gitlab-mr', () => {
    expect(detectProvider('https://gitlab.com/group/project/-/merge_requests/9')).toBe('gitlab-mr');
  });

  test('detects bitbucket', () => {
    expect(detectProvider('https://bitbucket.org/team/repo/pull-requests/3')).toBe('bitbucket');
  });

  test('detects a self-hosted gitlab issue on a gitlab.* host', () => {
    expect(detectProvider('https://gitlab.acme.com/group/project/-/issues/12')).toBe('gitlab-issue');
    expect(detectProvider('https://gitlab.acme.com/group/project/-/merge_requests/8')).toBe('gitlab-mr');
  });

  test('detects a self-hosted gitlab host that merely contains "gitlab"', () => {
    // The factory recognizes any host whose name contains "gitlab"; link-detect
    // must agree so a self-hosted instance unfurls the same everywhere.
    expect(detectProvider('https://mygitlab.internal/team/app/-/issues/3')).toBe('gitlab-issue');
    expect(detectProvider('https://mygitlab.internal/team/app/-/merge_requests/4')).toBe('gitlab-mr');
  });

  test('detects confluence (atlassian wiki, not jira)', () => {
    expect(detectProvider('https://myco.atlassian.net/wiki/spaces/ENG/pages/123/Design')).toBe('confluence');
  });

  test('detects slack', () => {
    expect(detectProvider('https://myworkspace.slack.com/archives/C123/p1700000000')).toBe('slack');
  });

  test('detects linear', () => {
    expect(detectProvider('https://linear.app/acme/issue/ENG-123/some-title')).toBe('linear');
  });

  test('detects notion (with and without www)', () => {
    expect(detectProvider('https://www.notion.so/acme/Design-Doc-abc123')).toBe('notion');
    expect(detectProvider('https://notion.so/acme/Design-Doc-abc123')).toBe('notion');
  });

  test('falls back to generic for an unrecognized url', () => {
    expect(detectProvider('https://example.com/some/page')).toBe('generic');
  });
});

describe('extractKey', () => {
  test('extracts jira key from browse path', () => {
    expect(extractKey('https://myco.atlassian.net/browse/PROJ-123', 'jira')).toBe('PROJ-123');
  });

  test('extracts jira key even with a query string', () => {
    expect(extractKey('https://myco.atlassian.net/browse/PROJ-123?filter=x', 'jira')).toBe('PROJ-123');
  });

  test('extracts github issue number', () => {
    expect(extractKey('https://github.com/owner/repo/issues/42', 'github-issue')).toBe('42');
  });

  test('extracts github pr number', () => {
    expect(extractKey('https://github.com/owner/repo/pull/7', 'github-pr')).toBe('7');
  });

  test('extracts gitlab issue number', () => {
    expect(extractKey('https://gitlab.com/group/project/-/issues/5', 'gitlab-issue')).toBe('5');
  });

  test('extracts gitlab mr number', () => {
    expect(extractKey('https://gitlab.com/group/project/-/merge_requests/9', 'gitlab-mr')).toBe('9');
  });

  test('extracts bitbucket pull-request number', () => {
    expect(extractKey('https://bitbucket.org/team/repo/pull-requests/3', 'bitbucket')).toBe('3');
  });

  test('extracts linear key', () => {
    expect(extractKey('https://linear.app/acme/issue/ENG-123/some-title', 'linear')).toBe('ENG-123');
  });

  test('returns null for providers without a key extractor', () => {
    expect(extractKey('https://myco.atlassian.net/wiki/spaces/ENG/pages/123', 'confluence')).toBeNull();
    expect(extractKey('https://myworkspace.slack.com/archives/C123', 'slack')).toBeNull();
    expect(extractKey('https://www.notion.so/acme/Doc-abc123', 'notion')).toBeNull();
    expect(extractKey('https://example.com/page', 'generic')).toBeNull();
  });

  test('returns null when the extractor pattern does not match the url', () => {
    expect(extractKey('https://github.com/owner/repo', 'github-issue')).toBeNull();
    expect(extractKey('https://myco.atlassian.net/browse/nokeyhere', 'jira')).toBeNull();
  });
});

describe('getProviderIcon', () => {
  test('returns the expected icon for every provider', () => {
    expect(getProviderIcon('jira')).toBe('i-simple-icons-jira');
    expect(getProviderIcon('github-issue')).toBe('i-simple-icons-github');
    expect(getProviderIcon('github-pr')).toBe('i-simple-icons-github');
    expect(getProviderIcon('gitlab-issue')).toBe('i-simple-icons-gitlab');
    expect(getProviderIcon('gitlab-mr')).toBe('i-simple-icons-gitlab');
    expect(getProviderIcon('bitbucket')).toBe('i-simple-icons-bitbucket');
    expect(getProviderIcon('confluence')).toBe('i-simple-icons-confluence');
    expect(getProviderIcon('slack')).toBe('i-simple-icons-slack');
    expect(getProviderIcon('linear')).toBe('i-simple-icons-linear');
    expect(getProviderIcon('notion')).toBe('i-simple-icons-notion');
    expect(getProviderIcon('generic')).toBe('i-lucide-link');
  });
});
