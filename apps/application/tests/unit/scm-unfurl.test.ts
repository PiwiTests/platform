import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { GitHubProvider } from '~~/server/utils/scm/GitHubProvider';
import { GitLabProvider } from '~~/server/utils/scm/GitLabProvider';
import { BitbucketProvider } from '~~/server/utils/scm/BitbucketProvider';
import { ScmUnfurlProvider } from '~~/server/utils/unfurl/ScmUnfurlProvider';

/** A minimal `fetch` Response carrying JSON, or a non-2xx status. */
function jsonResponse(body: unknown, ok = true, status = 200) {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as unknown as Response;
}

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal('fetch', fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

/** The headers object passed to the most recent fetch call. */
function lastHeaders(): Record<string, string> {
  const call = fetchMock.mock.calls.at(-1);
  return (call?.[1]?.headers ?? {}) as Record<string, string>;
}

describe('GitHubProvider issue/PR unfurl', () => {
  test('fetchPullRequest maps open, merged and draft states', async () => {
    const gh = new GitHubProvider('owner/repo', 'tok');

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        title: 'Add feature',
        state: 'open',
        merged: false,
        draft: false,
        user: { login: 'ada' },
        html_url: 'https://github.com/owner/repo/pull/7',
        updated_at: '2026-01-02T03:04:05Z',
      }),
    );
    expect(await gh.fetchPullRequest(7)).toEqual({
      title: 'Add feature',
      state: 'open',
      author: 'ada',
      url: 'https://github.com/owner/repo/pull/7',
      updatedAt: '2026-01-02T03:04:05Z',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'Merged', state: 'closed', merged: true }));
    expect((await gh.fetchPullRequest(7))?.state).toBe('merged');

    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'WIP', state: 'open', draft: true }));
    expect((await gh.fetchPullRequest(7))?.state).toBe('draft');
  });

  test('fetchIssue maps open and closed states', async () => {
    const gh = new GitHubProvider('owner/repo', 'tok');
    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'Bug', state: 'closed', user: { login: 'lin' } }));
    const issue = await gh.fetchIssue(42);
    expect(issue?.state).toBe('closed');
    expect(issue?.title).toBe('Bug');
    // Issues go through the `issues` endpoint, PRs through `pulls`.
    expect(fetchMock.mock.calls[0]?.[0]).toBe('https://api.github.com/repos/owner/repo/issues/42');
  });

  test('returns null when the entity is not found', async () => {
    const gh = new GitHubProvider('owner/repo', 'tok');
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: 'Not Found' }, false, 404));
    expect(await gh.fetchPullRequest(999)).toBeNull();
  });

  test('a token-less provider fetches the public API with no Authorization header', async () => {
    const gh = new GitHubProvider('owner/repo', null);
    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'Public', state: 'open' }));
    const issue = await gh.fetchIssue(1);
    expect(issue?.title).toBe('Public');
    expect('Authorization' in lastHeaders()).toBe(false);
  });
});

describe('GitLabProvider issue/MR unfurl', () => {
  test('fetchIssue maps opened → open and reads the author', async () => {
    const gl = new GitLabProvider('gitlab.com', 'group/project', 'tok');
    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        title: 'Flaky spec',
        state: 'opened',
        author: { name: 'Grace Hopper', username: 'grace' },
        web_url: 'https://gitlab.com/group/project/-/issues/5',
        updated_at: '2026-02-01T00:00:00Z',
      }),
    );
    expect(await gl.fetchIssue(5)).toEqual({
      title: 'Flaky spec',
      state: 'open',
      author: 'Grace Hopper',
      url: 'https://gitlab.com/group/project/-/issues/5',
      updatedAt: '2026-02-01T00:00:00Z',
    });
  });

  test('fetchPullRequest maps merged and draft, and is self-hosted-host aware', async () => {
    const gl = new GitLabProvider('gitlab.acme.com', 'group/project', 'tok');

    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'MR', state: 'merged' }));
    expect((await gl.fetchPullRequest(8))?.state).toBe('merged');
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'https://gitlab.acme.com/api/v4/projects/group%2Fproject/merge_requests/8',
    );

    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'MR', state: 'opened', work_in_progress: true }));
    expect((await gl.fetchPullRequest(8))?.state).toBe('draft');
  });

  test('returns null when the entity is not found', async () => {
    const gl = new GitLabProvider('gitlab.com', 'group/project', null);
    fetchMock.mockResolvedValueOnce(jsonResponse({ message: '404 Not found' }, false, 404));
    expect(await gl.fetchIssue(404)).toBeNull();
    expect('Authorization' in lastHeaders()).toBe(false);
  });
});

describe('BitbucketProvider issue/PR unfurl', () => {
  test('fetchPullRequest maps MERGED, OPEN and DECLINED states', async () => {
    const bb = new BitbucketProvider('team', 'repo', 'tok');

    fetchMock.mockResolvedValueOnce(
      jsonResponse({
        title: 'PR',
        state: 'MERGED',
        author: { display_name: 'Alan' },
        links: { html: { href: 'https://bitbucket.org/team/repo/pull-requests/3' } },
        updated_on: '2026-03-01T00:00:00Z',
      }),
    );
    expect(await bb.fetchPullRequest(3)).toEqual({
      title: 'PR',
      state: 'merged',
      author: 'Alan',
      url: 'https://bitbucket.org/team/repo/pull-requests/3',
      updatedAt: '2026-03-01T00:00:00Z',
    });

    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'PR', state: 'OPEN' }));
    expect((await bb.fetchPullRequest(3))?.state).toBe('open');

    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'PR', state: 'DECLINED' }));
    expect((await bb.fetchPullRequest(3))?.state).toBe('closed');
  });

  test('fetchIssue maps new → open and resolved → closed', async () => {
    const bb = new BitbucketProvider('team', 'repo', null);
    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'Issue', state: 'new' }));
    expect((await bb.fetchIssue(1))?.state).toBe('open');
    expect('Authorization' in lastHeaders()).toBe(false);

    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'Issue', state: 'resolved' }));
    expect((await bb.fetchIssue(1))?.state).toBe('closed');
  });

  test('returns null when the entity is not found', async () => {
    const bb = new BitbucketProvider('team', 'repo', 'tok');
    fetchMock.mockResolvedValueOnce(jsonResponse({}, false, 404));
    expect(await bb.fetchPullRequest(9)).toBeNull();
  });
});

describe('ScmUnfurlProvider maps entity state onto the card badge', () => {
  test('a merged GitHub PR renders as Merged / success', async () => {
    const provider = new ScmUnfurlProvider('github-pr', new GitHubProvider('owner/repo', null));
    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'Add feature', state: 'closed', merged: true }));
    expect(await provider.unfurl('https://github.com/owner/repo/pull/7', '7')).toEqual({
      title: 'Add feature',
      statusText: 'Merged',
      statusColor: 'success',
    });
  });

  test('a closed GitHub issue renders as Closed / neutral', async () => {
    const provider = new ScmUnfurlProvider('github-issue', new GitHubProvider('owner/repo', null));
    fetchMock.mockResolvedValueOnce(jsonResponse({ title: 'Bug', state: 'closed' }));
    expect(await provider.unfurl('https://github.com/owner/repo/issues/42', '42')).toEqual({
      title: 'Bug',
      statusText: 'Closed',
      statusColor: 'neutral',
    });
  });

  test('a missing key returns an empty result without fetching', async () => {
    const provider = new ScmUnfurlProvider('github-pr', new GitHubProvider('owner/repo', null));
    expect(await provider.unfurl('https://github.com/owner/repo/pull/7', null)).toEqual({
      title: null,
      statusText: null,
      statusColor: null,
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
