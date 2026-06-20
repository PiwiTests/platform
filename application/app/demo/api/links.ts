/**
 * Client-side implementations of the /api/links* endpoints for demo mode.
 *
 * Thin wrappers that delegate to shared handler functions.
 */

import { getDemoDb } from '../db.client';
import { listLinks, createLink, patchLink, deleteLink, refreshLinkMeta } from '~~/shared/handlers/links';

/** GET /api/links?entityType=&entityId= */
export async function apiGetLinks(entityType: string, entityId: number) {
  return listLinks(await getDemoDb(), entityType, entityId);
}

/** POST /api/links */
export async function apiCreateLink(body: {
  entityType: 'test_run' | 'test_runs_case' | 'test_case';
  entityId: number;
  url: string;
  title?: string | null;
}) {
  return createLink(await getDemoDb(), body);
}

/** PATCH /api/links/:id */
export async function apiPatchLink(id: number, body: { url?: string; title?: string | null }) {
  return patchLink(await getDemoDb(), id, body);
}

/** DELETE /api/links/:id */
export async function apiDeleteLink(id: number) {
  return deleteLink(await getDemoDb(), id);
}

/** POST /api/links/:id/refresh */
export async function apiRefreshLink(id: number) {
  return refreshLinkMeta(await getDemoDb(), id);
}
