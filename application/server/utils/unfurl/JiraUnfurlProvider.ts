import { UnfurlProvider, type UnfurlResult, UNFURL_TIMEOUT_MS } from './UnfurlProvider';

export interface AtlassianConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

export class JiraUnfurlProvider extends UnfurlProvider {
  readonly provider = 'jira' as const;

  constructor(private readonly config: AtlassianConfig) {
    super();
  }

  async unfurl(url: string, key: string | null): Promise<UnfurlResult> {
    if (!key) return { title: null, statusText: null, statusColor: null };

    const apiUrl = `${this.config.baseUrl.replace(/\/$/, '')}/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status`;

    try {
      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64')}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(UNFURL_TIMEOUT_MS),
      });

      if (!response.ok) return { title: null, statusText: null, statusColor: null };

      const data = (await response.json()) as {
        fields?: {
          summary?: string;
          status?: {
            name?: string;
            statusCategory?: {
              key?: string;
              name?: string;
            };
          };
        };
      };

      const title = data.fields?.summary ?? null;
      const statusName = data.fields?.status?.name ?? null;
      const categoryKey = data.fields?.status?.statusCategory?.key ?? null;

      let statusColor: string | null = null;
      if (categoryKey === 'done') statusColor = 'success';
      else if (categoryKey === 'indeterminate') statusColor = 'warning';
      else if (categoryKey === 'new') statusColor = 'info';

      return {
        title,
        statusText: statusName,
        statusColor,
      };
    } catch {
      return { title: null, statusText: null, statusColor: null };
    }
  }
}
