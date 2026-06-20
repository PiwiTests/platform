/**
 * Client-side implementation of the /api/admin/stats endpoint for demo mode.
 *
 * Thin wrapper that delegates to the shared handler.
 */

import { getDemoDb } from '../db.client';
import { getAdminStats } from '~~/shared/handlers/admin';

/** GET /api/admin/stats */
export async function apiGetAdminStats() {
  const stats = await getAdminStats(await getDemoDb());
  return { ...stats, storageSizeOnDisk: null };
}
