/**
 * The server's share-token minter for ticket bodies. Lives apart from the
 * builders because `server/utils/share-links` reads `node:crypto`, which the
 * in-browser demo cannot load — the demo builds the same tickets without it.
 */
import type { DbClient } from '../../database';
import { mintShareLink, shareLinksEnabled } from '../share-links';
import type { ShareTokenMinter } from './documents';

/** A minter bound to `db`; yields null when share links are disabled or minting fails. */
export function clusterShareTokenMinter(db: DbClient): ShareTokenMinter {
  return async (projectId, clusterId) => {
    if (!shareLinksEnabled()) return null;
    try {
      const minted = await mintShareLink(db, {
        projectId,
        entityKind: 'cluster',
        entityId: clusterId,
        createdBy: null,
      });
      return minted.token;
    } catch {
      return null;
    }
  };
}
