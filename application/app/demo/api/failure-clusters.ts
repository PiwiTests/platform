/**
 * Client-side implementations of the /api/failure-clusters* endpoints for demo mode.
 */

import { eq } from 'drizzle-orm'
import { getDemoDb } from '../db.client'
import { failureClusters } from '~~/server/database/schema.sqlite'

const VALID_STATUSES = ['open', 'resolved', 'ignored']

/** PATCH /api/failure-clusters/:id/status */
export async function apiPatchClusterStatus(id: number, body: { status?: string, triageNote?: string | null }) {
  const db = await getDemoDb()

  const [cluster] = await db.select({ id: failureClusters.id })
    .from(failureClusters)
    .where(eq(failureClusters.id, id))

  if (!cluster) return null

  const status = body?.status
  if (!status || !VALID_STATUSES.includes(status)) {
    return null
  }

  const triageNote = body?.triageNote ?? null

  await db.update(failureClusters)
    .set({ status, triageNote, updatedAt: new Date() })
    .where(eq(failureClusters.id, id))

  return { success: true, id, status, triageNote }
}
