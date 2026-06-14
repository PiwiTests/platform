import { getDatabase } from '../../database'
import { testRuns, testCases, testRunsCases, files, projects } from '../../database/schema'
import { sql } from 'drizzle-orm'
import { requireAuth } from '../../utils/auth'
import { getStorage } from '../../storage'
import { getDirectorySize } from '../../utils/filesize'
import { resolve } from 'path'

defineRouteMeta({
  openAPI: {
    tags: ['Admin'],
    summary: 'Get admin statistics',
    description: 'Returns aggregate statistics about projects, test runs, test cases, files, and storage disk usage. Requires administrator role.'
  }
})

export default eventHandler(async (event) => {
  await requireAuth(event, ['administrator'])

  const db = await getDatabase()

  const [
    totalProjects,
    totalRuns,
    totalTestCases,
    totalRunsCases,
    totalFiles
  ] = await Promise.all([
    db.select({ count: sql<number>`count(*)` }).from(projects),
    db.select({ count: sql<number>`count(*)` }).from(testRuns),
    db.select({ count: sql<number>`count(*)` }).from(testCases),
    db.select({ count: sql<number>`count(*)` }).from(testRunsCases),
    db.select({ count: sql<number>`count(*)` }).from(files)
  ])

  // Sum stored file sizes from DB
  const fileSizeResult = await db.select({
    total: sql<number>`coalesce(sum(size), 0)`
  }).from(files)

  const totalFileSize = Number(fileSizeResult[0]?.total ?? 0)

  // Try to get actual storage size on disk (local storage only)
  let storageSizeOnDisk: number | null = null
  try {
    const storage = getStorage()
    const storagePath = storage.getFullPath('')
    const absolutePath = resolve(storagePath)
    storageSizeOnDisk = await getDirectorySize(absolutePath)
  } catch {
    // S3 or other storage — skip disk size
  }

  return {
    totalProjects: Number(totalProjects[0]?.count ?? 0),
    totalRuns: Number(totalRuns[0]?.count ?? 0),
    totalTestCases: Number(totalTestCases[0]?.count ?? 0),
    totalRunsCases: Number(totalRunsCases[0]?.count ?? 0),
    totalFiles: Number(totalFiles[0]?.count ?? 0),
    totalFileSize,
    storageSizeOnDisk
  }
})
