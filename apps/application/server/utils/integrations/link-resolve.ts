import { detectProvider, extractKey, type LinkProvider } from '#shared/link-detect';
import type { IntegrationProviderName } from '#shared/integrations/registry';
import { integrationConnections } from '../../database/schema';
import type { DbClient } from '../../database';
import { ensureEnvManagedConnections, trackerForRow } from './connections';

/** How a URL resolved: its provider, the connection that recognized it, its key. */
export interface ResolvedLink {
  provider: LinkProvider;
  /** The connection that can read/write this record, or null for a pure link. */
  connectionId: number | null;
  /** The issue key parsed from the URL. */
  key: string | null;
}

/**
 * Resolve a link URL against the configured connections first — so a self-hosted
 * `https://jira.company.com/browse/XYZ-99` is recognized as Jira once that host
 * is connected — then fall back to the pure, URL-shape-only `detectProvider`.
 */
export async function detectProviderWithConnections(db: DbClient, url: string): Promise<ResolvedLink> {
  await ensureEnvManagedConnections(db);
  const rows = await db.select().from(integrationConnections);
  for (const row of rows) {
    const tracker = trackerForRow(row);
    const match = tracker?.parseIssueUrl(url);
    if (match) {
      return {
        provider: row.provider as IntegrationProviderName as LinkProvider,
        connectionId: row.id,
        key: match.key,
      };
    }
  }
  const provider = detectProvider(url);
  return { provider, connectionId: null, key: extractKey(url, provider) };
}
