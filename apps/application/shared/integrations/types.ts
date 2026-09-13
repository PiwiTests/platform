/**
 * Wire shapes the integration UI reads. Credentials never appear here — a
 * connection summary carries only a `hasCredentials` flag, and the test result
 * carries the resolved account, not the token that resolved it.
 */
import type { IntegrationProviderName } from './registry';

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
