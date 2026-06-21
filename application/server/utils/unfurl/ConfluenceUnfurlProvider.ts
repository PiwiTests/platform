import { UnfurlProvider, type UnfurlResult, UNFURL_TIMEOUT_MS } from './UnfurlProvider';
import type { AtlassianConfig } from './JiraUnfurlProvider';

export class ConfluenceUnfurlProvider extends UnfurlProvider {
  readonly provider = 'confluence' as const;

  constructor(private readonly config: AtlassianConfig) {
    super();
  }

  async unfurl(url: string, _key: string | null): Promise<UnfurlResult> {
    const pageId = this.extractPageId(url);
    if (!pageId) return { title: null, statusText: null, statusColor: null };

    const apiUrl = `${this.config.baseUrl.replace(/\/$/, '')}/wiki/api/v2/pages/${encodeURIComponent(pageId)}`;

    try {
      const response = await fetch(apiUrl, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64')}`,
          Accept: 'application/json',
        },
        signal: AbortSignal.timeout(UNFURL_TIMEOUT_MS),
      });

      if (!response.ok) return { title: null, statusText: null, statusColor: null };

      const data = (await response.json()) as { title?: string };
      return {
        title: data.title ?? null,
        statusText: null,
        statusColor: null,
      };
    } catch {
      return { title: null, statusText: null, statusColor: null };
    }
  }

  private extractPageId(url: string): string | null {
    // Confluence URLs: /wiki/spaces/{spaceKey}/pages/{pageId}/...
    const pageMatch = url.match(/\/pages\/(\d+)/);
    if (pageMatch?.[1]) return pageMatch[1];

    // Some Confluence cloud URLs: /wiki/{pageId}
    const directMatch = url.match(/\/wiki\/(\d+)(?:\?|$|#)/);
    if (directMatch?.[1]) return directMatch[1];

    return null;
  }
}
