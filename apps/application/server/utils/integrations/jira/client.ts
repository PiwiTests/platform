import type { IssueDocument } from '#shared/integrations/document';
import type {
  CreateIssueInput,
  IssueTracker,
  TrackerCredentials,
  TrackerIssue,
  TrackerIssueType,
  TrackerProject,
  TrackerSearch,
  TrackerTransition,
  TrackerUser,
} from '../types';
import { statusColorForCategory, toStatusCategory } from '../types';

const JIRA_TIMEOUT_MS = 10_000;

export interface JiraClientConfig {
  baseUrl: string;
  email: string;
  apiToken: string;
}

interface JiraStatus {
  name?: string;
  statusCategory?: { key?: string };
}

interface JiraUser {
  accountId?: string;
  displayName?: string;
  emailAddress?: string | null;
}

interface JiraIssueResponse {
  key?: string;
  fields?: {
    summary?: string;
    status?: JiraStatus;
    assignee?: JiraUser | null;
  };
}

/** A Jira REST error that keeps the credential out of its message. */
export class JiraError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'JiraError';
  }
}

/**
 * Jira Cloud client (REST v3, Basic `email:apiToken`). Reads and writes go
 * through the one interface every tracker implements; the base URL is
 * administrator-supplied and therefore trusted.
 */
export class JiraClient implements IssueTracker {
  readonly provider = 'jira' as const;
  private readonly baseUrl: string;

  constructor(private readonly config: JiraClientConfig) {
    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
  }

  static fromCredentials(baseUrl: string, credentials: TrackerCredentials): JiraClient {
    return new JiraClient({ baseUrl, email: credentials.email, apiToken: credentials.apiToken });
  }

  private authHeader(): string {
    return `Basic ${Buffer.from(`${this.config.email}:${this.config.apiToken}`).toString('base64')}`;
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: this.authHeader(),
        Accept: 'application/json',
        ...(init?.body ? { 'Content-Type': 'application/json' } : {}),
        ...init?.headers,
      },
      signal: AbortSignal.timeout(JIRA_TIMEOUT_MS),
    });
    if (!response.ok) {
      throw new JiraError(response.status, `Jira request failed (${response.status} ${response.statusText})`);
    }
    if (response.status === 204) return undefined as T;
    return (await response.json()) as T;
  }

  async whoAmI(): Promise<{ id: string; displayName: string }> {
    const me = await this.request<JiraUser>('/rest/api/3/myself');
    return { id: me.accountId ?? '', displayName: me.displayName ?? me.emailAddress ?? '' };
  }

  private toIssue(data: JiraIssueResponse, key: string): TrackerIssue {
    const category = toStatusCategory(data.fields?.status?.statusCategory?.key ?? null);
    const assignee = data.fields?.assignee ?? null;
    return {
      key: data.key ?? key,
      url: this.issueUrl(data.key ?? key),
      title: data.fields?.summary ?? null,
      status: data.fields?.status?.name ?? null,
      statusCategory: category,
      statusColor: statusColorForCategory(category),
      assignee: assignee?.accountId
        ? {
            id: assignee.accountId,
            displayName: assignee.displayName ?? '',
            email: assignee.emailAddress ?? null,
          }
        : null,
    };
  }

  async getIssue(key: string): Promise<TrackerIssue | null> {
    try {
      const data = await this.request<JiraIssueResponse>(
        `/rest/api/3/issue/${encodeURIComponent(key)}?fields=summary,status,assignee`,
      );
      return this.toIssue(data, key);
    } catch (err) {
      if (err instanceof JiraError && err.status === 404) return null;
      throw err;
    }
  }

  async listProjects(): Promise<TrackerProject[]> {
    const data = await this.request<{ values?: { id?: string; key?: string; name?: string }[] }>(
      '/rest/api/3/project/search?maxResults=100',
    );
    return (data.values ?? []).map((p) => ({ id: p.id ?? '', key: p.key ?? '', name: p.name ?? '' }));
  }

  async listIssueTypes(projectKey: string): Promise<TrackerIssueType[]> {
    const data = await this.request<{ issueTypes?: { id?: string; name?: string }[] }>(
      `/rest/api/3/project/${encodeURIComponent(projectKey)}`,
    );
    return (data.issueTypes ?? []).map((t) => ({ id: t.id ?? '', name: t.name ?? '' }));
  }

  async searchAssignable(projectKey: string, query: string): Promise<TrackerUser[]> {
    const params = new URLSearchParams({ project: projectKey, query, maxResults: '20' });
    const data = await this.request<JiraUser[]>(`/rest/api/3/user/assignable/search?${params.toString()}`);
    return (data ?? [])
      .filter((u) => u.accountId)
      .map((u) => ({ id: u.accountId ?? '', displayName: u.displayName ?? '', email: u.emailAddress ?? null }));
  }

  async listTransitions(key: string): Promise<TrackerTransition[]> {
    const data = await this.request<{ transitions?: { id?: string; name?: string; to?: { name?: string } }[] }>(
      `/rest/api/3/issue/${encodeURIComponent(key)}/transitions`,
    );
    return (data.transitions ?? []).map((t) => ({
      id: t.id ?? '',
      name: t.name ?? '',
      toStatus: t.to?.name ?? null,
    }));
  }

  async transition(key: string, transitionId: string): Promise<void> {
    await this.request<void>(`/rest/api/3/issue/${encodeURIComponent(key)}/transitions`, {
      method: 'POST',
      body: JSON.stringify({ transition: { id: transitionId } }),
    });
  }

  async search(query: TrackerSearch): Promise<TrackerIssue[]> {
    const jql = query.jql ?? buildJql(query);
    const data = await this.request<{ issues?: JiraIssueResponse[] }>('/rest/api/3/search/jql', {
      method: 'POST',
      body: JSON.stringify({
        jql,
        maxResults: query.limit ?? 20,
        fields: ['summary', 'status', 'assignee'],
      }),
    });
    return (data.issues ?? []).map((issue) => this.toIssue(issue, issue.key ?? ''));
  }

  createIssue(_input: CreateIssueInput): Promise<TrackerIssue> {
    return Promise.reject(new Error('Creating Jira issues is not available yet'));
  }

  addComment(_key: string, _body: IssueDocument): Promise<void> {
    return Promise.reject(new Error('Commenting on Jira issues is not available yet'));
  }

  issueUrl(key: string): string {
    return `${this.baseUrl}/browse/${key}`;
  }

  parseIssueUrl(url: string): { key: string } | null {
    let parsed: URL;
    let base: URL;
    try {
      parsed = new URL(url);
      base = new URL(this.baseUrl);
    } catch {
      return null;
    }
    if (parsed.host !== base.host) return null;
    // <baseUrl>/browse/KEY-123
    const browse = /\/browse\/([A-Z][A-Z0-9_]+-\d+)(?:$|[?#/])/i.exec(parsed.pathname);
    if (browse?.[1]) return { key: browse[1].toUpperCase() };
    // <baseUrl>/jira/software/c/projects/KEY/…?selectedIssue=KEY-123
    const selected = parsed.searchParams.get('selectedIssue');
    if (selected && /^[A-Z][A-Z0-9_]+-\d+$/i.test(selected)) return { key: selected.toUpperCase() };
    const projectIssue = /\/jira\/software\/c\/projects\/[^/]+\/issues\/([A-Z][A-Z0-9_]+-\d+)/i.exec(parsed.pathname);
    if (projectIssue?.[1]) return { key: projectIssue[1].toUpperCase() };
    return null;
  }
}

/** Translate a neutral search into JQL: label AND text clauses, ordered by update. */
function buildJql(query: TrackerSearch): string {
  const clauses: string[] = [];
  for (const label of query.labels ?? []) {
    clauses.push(`labels = ${JSON.stringify(label)}`);
  }
  if (query.text) {
    clauses.push(`text ~ ${JSON.stringify(query.text)}`);
  }
  const where = clauses.length ? clauses.join(' AND ') : 'order by updated desc';
  return clauses.length ? `${where} order by updated desc` : where;
}
