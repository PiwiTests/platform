/**
 * Wire shapes the integration UI reads. Secret credentials never appear here — a
 * connection summary carries a `hasCredentials` flag and its non-secret credential
 * values (the account email), and the test result carries the resolved account,
 * not the token that resolved it.
 */
import type { IntegrationProviderName } from './registry';
import type { IssueDocument } from './document';
import type { IssueLocale } from './messages';

export type ConnectionStatus = 'unverified' | 'ok' | 'failed';
export type ConnectionManagedBy = 'db' | 'env';

/** A connection as the settings page sees it — no secret fields. */
export interface ConnectionSummary {
  id: number;
  provider: IntegrationProviderName;
  name: string;
  baseUrl: string;
  /** Provider-specific, non-secret configuration (flavor, site id, …). */
  config: Record<string, unknown> | null;
  status: ConnectionStatus;
  lastCheckedAt: string | null;
  lastError: string | null;
  managedBy: ConnectionManagedBy;
  /** True when the connection has stored credentials, without revealing them. */
  hasCredentials: boolean;
  /**
   * The non-secret credential values (e.g. the account email), so the settings UI
   * can show the account and pre-fill the edit form. Secret fields such as the API
   * token are never included.
   */
  credentialValues: Record<string, string>;
  /** True when an inbound-webhook token is set (the token itself is never returned). */
  hasWebhookToken: boolean;
  createdAt: string | null;
  updatedAt: string | null;
}

/** The body the connect form submits (credentials are a plain map by field key). */
export interface ConnectionInput {
  provider: IntegrationProviderName;
  name: string;
  baseUrl: string;
  config?: Record<string, unknown> | null;
  /** Field-key → value; an empty or omitted map on update keeps the stored one. */
  credentials?: Record<string, string> | null;
}

/** The result of testing a connection (`POST connections/:id/test`). */
export interface ConnectionTestResult {
  ok: boolean;
  /** The account the credentials resolved to, when the test succeeded. */
  account?: { id: string; displayName: string };
  /** Provider error text when the test failed. */
  error?: string;
}

/** A tracker the UI can file into — what `GET status` returns. */
export interface TrackerSummary {
  id: number;
  provider: IntegrationProviderName;
  name: string;
}

/** A tracker project option for the create modal's picker. */
export interface TrackerProjectOption {
  id: string;
  key: string;
  name: string;
}

/** An issue-type option for the create modal's picker. */
export interface TrackerIssueTypeOption {
  id: string;
  name: string;
}

/** An assignable-user option for the create modal's picker. */
export interface TrackerUserOption {
  id: string;
  displayName: string;
  email?: string | null;
}

/** An issue that may already track the failure — leads the modal so a person links it. */
export interface ExistingIssueCandidate {
  key: string;
  url: string;
  title: string | null;
  statusText: string | null;
  statusColor: string | null;
  /** Why it was surfaced: pinned link, matching label/fingerprint, or fixed-before. */
  reason: 'linked' | 'label' | 'fingerprint' | 'fixed-before';
}

/** The toggles for what a ticket body carries. */
export interface IssueIncludeOptions {
  includeDiagnosis: boolean;
  includePatch: boolean;
  includeScreenshot: boolean;
  includeShareLink: boolean;
}

/** The prefilled draft `GET issue-draft` returns; the modal edits it and POSTs it back. */
export interface IssueDraft {
  entityType: 'failure_cluster' | 'test_runs_case';
  entityId: number;
  /** The cluster the created link attaches to (the entity's own cluster). */
  clusterId: number | null;
  title: string;
  connectionId: number | null;
  connections: TrackerSummary[];
  projectKey: string | null;
  issueType: string | null;
  labels: string[];
  assignee: string | null;
  /** The language the ticket is written in — binding, else connection default, else en. */
  locale: IssueLocale;
  include: IssueIncludeOptions;
  /** Markdown preview of the body — what the modal renders through `MarkdownPreview`. */
  markdown: string;
  /** The neutral document the preview renders, for inspection. */
  document: IssueDocument;
  existing: ExistingIssueCandidate[];
}

/** The body `POST issues` accepts — the draft with a person's edits. */
export interface CreateIssueRequest {
  entityType: 'failure_cluster' | 'test_runs_case';
  entityId: number;
  connectionId: number;
  title: string;
  projectKey: string;
  issueType: string;
  labels?: string[];
  assignee?: string | null;
  locale?: IssueLocale;
  include?: Partial<IssueIncludeOptions>;
}

/** What `POST issues` returns once the immediate attempt resolves. */
export interface CreateIssueResponse {
  actionId: number;
  status: 'done' | 'pending' | 'failed' | 'skipped';
  key?: string;
  url?: string;
  error?: string;
}
