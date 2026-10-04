import { describe, test, expect, afterEach, vi } from 'vitest';
import { scmProviderForUrl } from '../../server/utils/scm';
import { GitHubProvider } from '../../server/utils/scm/GitHubProvider';
import { GitLabProvider } from '../../server/utils/scm/GitLabProvider';
import { BitbucketProvider } from '../../server/utils/scm/BitbucketProvider';

afterEach(() => {
  delete process.env.PIWI_SCM_GITLAB_HOSTS;
  vi.restoreAllMocks();
});

describe('scmProviderForUrl sends the token only to known hosts', () => {
  test('GitHub, gitlab.com and Bitbucket get a provider', () => {
    expect(scmProviderForUrl('https://github.com/acme/app', 'tok')).toBeInstanceOf(GitHubProvider);
    expect(scmProviderForUrl('https://gitlab.com/acme/app', 'tok')).toBeInstanceOf(GitLabProvider);
    expect(scmProviderForUrl('https://bitbucket.org/acme/app', 'tok')).toBeInstanceOf(BitbucketProvider);
  });

  test('a GitLab-looking host that is not configured gets no provider', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(scmProviderForUrl('https://gitlab.attacker.example/acme/app', 'tok')).toBeNull();
    expect(scmProviderForUrl('https://notgitlab.example/acme/app', 'tok')).toBeNull();
  });

  test('a host listed in PIWI_SCM_GITLAB_HOSTS gets a GitLab provider', () => {
    process.env.PIWI_SCM_GITLAB_HOSTS = 'git.example.com, GitLab.Example.org';
    expect(scmProviderForUrl('https://git.example.com/group/app', 'tok')).toBeInstanceOf(GitLabProvider);
    expect(scmProviderForUrl('https://gitlab.example.org/group/app', 'tok')).toBeInstanceOf(GitLabProvider);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(scmProviderForUrl('https://gitlab.other.example/group/app', 'tok')).toBeNull();
  });
});
