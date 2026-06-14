import { getDatabase } from '../../../database'
import { failureClusters, testRuns } from '../../../database/schema'
import { eq } from 'drizzle-orm'
import { normalizeGitUrl } from '../../../utils/regression-context'
import { fetchRecentCommits } from '../../../utils/scm-provider'
import { getAppSetting } from '../../../utils/app-settings'

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
  const remoteUrl: string | null = meta?.scm?.remoteUrl ?? null
  const repositoryUrl = normalizeGitUrl(remoteUrl)

  if (!repositoryUrl) return { commits: [], repositoryUrl: null }

  const scmTokenSetting = await getAppSetting<{ value?: string }>(db, 'scm_token')
  const scmToken = scmTokenSetting?.value ?? null

  const commits = await fetchRecentCommits(repositoryUrl, scmToken)
  return { commits, repositoryUrl }
})
