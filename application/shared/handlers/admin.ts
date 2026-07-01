import { testRuns, testCases, testRunsCases, files, projects } from '../../server/database/schema';
import { count, sql } from 'drizzle-orm';

import type { DrizzleDB } from './db';

export async function getAdminStats(db: DrizzleDB) {
  const [totalProjects, totalRuns, totalTestCasesRow, totalRunsCasesRow, totalFiles] = await Promise.all([
    db.select({ count: count() }).from(projects),
    db.select({ count: count() }).from(testRuns),
    db.select({ count: count() }).from(testCases),
    db.select({ count: count() }).from(testRunsCases),
    db.select({ count: count() }).from(files),
  ]);

  const fileSizeResult = await db.select({ total: sql<number>`coalesce(sum(size), 0)` }).from(files);

  return {
    totalProjects: Number(totalProjects[0]?.count ?? 0),
    totalRuns: Number(totalRuns[0]?.count ?? 0),
    totalTestCases: Number(totalTestCasesRow[0]?.count ?? 0),
    totalRunsCases: Number(totalRunsCasesRow[0]?.count ?? 0),
    totalFiles: Number(totalFiles[0]?.count ?? 0),
    totalFileSize: Number(fileSizeResult[0]?.total ?? 0),
  };
}
