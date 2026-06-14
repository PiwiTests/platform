import { getDatabase } from '../../../database'
import { failureClusters, testRuns } from '../../../database/schema'
import { eq } from 'drizzle-orm'
import { normalizeGitUrl } from '../../../utils/regression-context'
import { createScmProvider } from '../../../utils/scm'

export default eventHandler(async (event) => {
  const id = parseInt(getRouterParam(event, 'id') || '0')
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' })

  const db = await getDatabase()
  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id))
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' })

  const [run] = await db.select({ metadata: testRuns.metadata })
    .from(testRuns)
    .where(eq(testRuns.id, cluster.lastSeenRunId))

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = run?.metadata as any
  const repositoryUrl = normalizeGitUrl(meta?.scm?.remoteUrl ?? null)

  if (!repositoryUrl) return { commits: [], repositoryUrl: null, aggregate: null, error: null }

  const provider = await createScmProvider(repositoryUrl, db)
  if (!provider) return { commits: [], repositoryUrl, aggregate: null, error: null }

  const query = getQuery(event)
  const baselineSha = query.baseline as string | undefined

  const commits = await provider.listCommitsWithStats()

  let error: string | null = null
  if (commits.length === 0) {
    error = await provider.probeError()
  }

  let aggregate: { filesChanged: number, linesAdded: number, linesRemoved: number } | null = null
  if (baselineSha && commits.length > 0) {
    const latestSha = commits[0]!.sha
    try {
      const diff = await provider.fetchChanges(baselineSha, latestSha)
      if (diff) {
        aggregate = {
          filesChanged: diff.files.length,
          linesAdded: diff.files.reduce((s, f) => s + f.additions, 0),
          linesRemoved: diff.files.reduce((s, f) => s + f.deletions, 0)
        }
      }
    } catch { /* stats unavailable */ }
  }

  return { commits, repositoryUrl, aggregate, error }
})
