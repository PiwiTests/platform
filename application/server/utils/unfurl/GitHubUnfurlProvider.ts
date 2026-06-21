import { UnfurlProvider, type UnfurlResult, UNFURL_TIMEOUT_MS } from './UnfurlProvider';

export class GitHubUnfurlProvider extends UnfurlProvider {
  readonly provider: 'github-issue' | 'github-pr';

  constructor(
    provider: 'github-issue' | 'github-pr',
    private readonly owner: string,
    private readonly repo: string,
    private readonly token?: string | null,
  ) {
    super();
    this.provider = provider;
  }

  async unfurl(url: string, key: string | null): Promise<UnfurlResult> {
    if (!key) return { title: null, statusText: null, statusColor: null };

    const isPr = this.provider === 'github-pr';
    const endpoint = isPr ? 'pulls' : 'issues';
    const apiUrl = `https://api.github.com/repos/${encodeURIComponent(this.owner)}/${encodeURIComponent(this.repo)}/${endpoint}/${encodeURIComponent(key)}`;

    try {
      const headers: Record<string, string> = {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Piwi-Dashboard/1.0 (+https://piwi.dashboard)',
      };
      if (this.token) {
        headers.Authorization = `Bearer ${this.token}`;
      }

      const response = await fetch(apiUrl, {
        headers,
        signal: AbortSignal.timeout(UNFURL_TIMEOUT_MS),
      });

      if (!response.ok) return { title: null, statusText: null, statusColor: null };

      const data = (await response.json()) as {
        title?: string;
        state?: string;
        merged?: boolean;
        draft?: boolean;
        pull_request?: object;
      };

      const title = data.title ?? null;
      const state = data.state ?? null;
      const merged = isPr ? data.merged : false;

      let statusText: string | null = null;
      let statusColor: string | null = null;

      if (isPr) {
        if (merged) {
          statusText = 'Merged';
          statusColor = 'success';
        } else if (state === 'closed') {
          statusText = 'Closed';
          statusColor = 'neutral';
        } else if (data.draft) {
          statusText = 'Draft';
          statusColor = 'neutral';
        } else {
          statusText = 'Open';
          statusColor = 'success';
        }
      } else {
        if (state === 'open') {
          statusText = 'Open';
          statusColor = 'success';
        } else if (state === 'closed') {
          statusText = 'Closed';
          statusColor = 'neutral';
        }
      }

      return { title, statusText, statusColor };
    } catch {
      return { title: null, statusText: null, statusColor: null };
    }
  }

  static parseUrl(url: string): { owner: string; repo: string } | null {
    try {
      const { pathname } = new URL(url);
      const match = pathname.replace(/^\/+/, '').match(/^([^/]+)\/([^/]+)/);
      if (match) {
        const owner = match[1];
        const repo = match[2];
        if (!owner || !repo) return null;
        return { owner, repo: repo.replace(/\.git$/, '') };
      }
    } catch {
      /* ignore */
    }
    return null;
  }
}
