import type { EntityLink } from '../../database/schema';
import type { DbClient } from '../../database';
import type { UnfurlResult } from '../unfurl/UnfurlProvider';
import { unfurlUrl } from '../unfurl';
import { createTracker } from './connections';

const EMPTY: UnfurlResult = { title: null, statusText: null, statusColor: null };

/**
 * Refresh a link's enrichment. A link bound to a connection reads its record
 * through that connection's tracker; a link without one keeps the generic unfurl
 * path (rich SCM/OpenGraph).
 */
export async function unfurlLink(
  db: DbClient,
  link: Pick<EntityLink, 'url' | 'connectionId' | 'externalId' | 'key'>,
): Promise<UnfurlResult> {
  if (link.connectionId) {
    const tracker = await createTracker(db, link.connectionId);
    if (!tracker) return EMPTY;
    const idOrKey = link.externalId ?? link.key;
    if (!idOrKey) return EMPTY;
    try {
      const issue = await tracker.getIssue(idOrKey);
      if (issue) return { title: issue.title, statusText: issue.status, statusColor: issue.statusColor };
    } catch {
      return EMPTY;
    }
    return EMPTY;
  }
  return unfurlUrl(link.url, db);
}
