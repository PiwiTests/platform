/**
 * Client-side implementation of the /api/admin/stats endpoint for demo mode.
 */

import { sql } from 'drizzle-orm'
import { getDemoDb } from '../db.client'
import { projects, testRuns, testCases, testRunsCases, traces, reports } from '~~/server/database/schema.sqlite'

/** GET /api/admin/stats */
export async function apiGetAdminStats() {
  const db = await getDemoDb()

  const [
    totalProjects,
    totalRuns,
    totalTestCases,
    totalRunsCases,
    totalTraces,
    totalReports
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(projects),
    db.select({ count: sql<number>`count(*)` }).from(testRuns),
    db.select({ count: sql<number>`count(*)` }).from(testCases),
    db.select({ count: sql<number>`count(*)` }).from(testRunsCases),
    db.select({ count: sql<number>`count(*)` }).from(traces),
    db.select({ count: sql<number>`count(*)` }).from(reports)
  ])

  const reportSizeResult = await db.select({
    total: sql<number>`coalesce(sum(size), 0)`
  }).from(reports)

  return {
    totalProjects: Number(totalProjects[0]?.count ?? 0),
    totalRuns: Number(totalRuns[0]?.count ?? 0),
    totalTestCases: Number(totalTestCases[0]?.count ?? 0),
    totalRunsCases: Number(totalRunsCases[0]?.count ?? 0),
    totalTraces: Number(totalTraces[0]?.count ?? 0),
    totalReports: Number(totalReports[0]?.count ?? 0),
    reportSizeFromDb: Number(reportSizeResult[0]?.total ?? 0),
    storageSizeOnDisk: null
  }
}
