import type { IssueDocument } from '#shared/integrations/document';

/** Tracker providers that have a server-side client. */
export type TrackerProviderName = 'jira';

/** A normalized status category, shared across trackers. */
export type TrackerStatusCategory = 'new' | 'indeterminate' | 'done';

export interface TrackerUser {
  id: string;
  displayName: string;
  email?: string | null;
}

export interface TrackerProject {
  id: string;
  key: string;
  name: string;
}

export interface TrackerIssueType {
  id: string;
  name: string;
}

export interface TrackerTransition {
  id: string;
  name: string;
  toStatus?: string | null;
}

export interface TrackerIssue {
  key: string;
  url: string;
  title: string | null;
  /** The status name shown to a reader, e.g. "In Progress". */
  status: string | null;
  statusCategory: TrackerStatusCategory | null;
  /** Badge color token resolved from the category (info / warning / success). */
  statusColor: string | null;
  assignee: TrackerUser | null;
}

export interface CreateIssueInput {
  projectKey: string;
  issueType: string;
  title: string;
  body: IssueDocument;
  labels?: string[];
  assigneeId?: string | null;
  priority?: string | null;
  componentId?: string | null;
}

export interface TrackerSearch {
  /** Free text matched against summary/description. */
  text?: string;
  /** Labels the issue must carry. */
  labels?: string[];
  /** A raw provider query (JQL for Jira), taking precedence when set. */
  jql?: string;
  limit?: number;
}

/**
 * The neutral interface every tracker client implements. A client carries a base
 * URL, a credential and a flavor across many calls, so it is a class — the
 * registry stays data, only the per-product client is stateful.
 */
export interface IssueTracker {
  readonly provider: TrackerProviderName;
  whoAmI(): Promise<{ id: string; displayName: string }>;
  listProjects(): Promise<TrackerProject[]>;
  listIssueTypes(projectKey: string): Promise<TrackerIssueType[]>;
  searchAssignable(projectKey: string, query: string): Promise<TrackerUser[]>;
  createIssue(input: CreateIssueInput): Promise<TrackerIssue>;
  getIssue(key: string): Promise<TrackerIssue | null>;
  addComment(key: string, body: IssueDocument): Promise<void>;
  listTransitions(key: string): Promise<TrackerTransition[]>;
  transition(key: string, transitionId: string): Promise<void>;
  search(query: TrackerSearch): Promise<TrackerIssue[]>;
  attach?(key: string, file: { name: string; bytes: Uint8Array; mime: string }): Promise<void>;
  issueUrl(key: string): string;
  parseIssueUrl(url: string): { key: string } | null;
}

/** The credential shape a tracker client is constructed with. */
export interface TrackerCredentials {
  email: string;
  apiToken: string;
}

/** Map a Jira `statusCategory.key` onto the unfurl badge color tokens. */
export function statusColorForCategory(category: TrackerStatusCategory | null): string | null {
  switch (category) {
    case 'done':
      return 'success';
    case 'indeterminate':
      return 'warning';
    case 'new':
      return 'info';
    default:
      return null;
  }
}

/** Narrow an arbitrary string to a known status category, else null. */
export function toStatusCategory(key: string | null | undefined): TrackerStatusCategory | null {
  return key === 'new' || key === 'indeterminate' || key === 'done' ? key : null;
}
