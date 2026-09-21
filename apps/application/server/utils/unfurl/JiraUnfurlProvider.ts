import { UnfurlProvider, type UnfurlResult, UNFURL_TIMEOUT_MS } from './UnfurlProvider';
import { JiraClient } from '../integrations/jira/client';

export interface AtlassianConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
  /** Set for a scoped-token connection, so unfurl routes through the gateway too. */
  cloudId?: string | null;
}

export class JiraUnfurlProvider extends UnfurlProvider {
  readonly provider = 'jira' as const;
  private readonly client: JiraClient;

  constructor(config: AtlassianConfig) {
    super();
    // Reuse the tracker client so classic and scoped tokens are handled the same
    // way; a shorter timeout keeps unfurl snappy.
    this.client = new JiraClient({
      baseUrl: config.baseUrl,
      email: config.email,
      apiToken: config.apiToken,
      cloudId: config.cloudId ?? null,
      timeoutMs: UNFURL_TIMEOUT_MS,
    });
  }

  async unfurl(_url: string, key: string | null): Promise<UnfurlResult> {
    if (!key) return { title: null, statusText: null, statusColor: null };
    try {
      const issue = await this.client.getIssue(key);
      if (!issue) return { title: null, statusText: null, statusColor: null };
      return { title: issue.title, statusText: issue.status, statusColor: issue.statusColor };
    } catch {
      return { title: null, statusText: null, statusColor: null };
    }
  }
}
