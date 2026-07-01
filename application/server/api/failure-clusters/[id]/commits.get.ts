import { failureClusters, testRuns } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { normalizeGitUrl } from '../../../utils/regression-context';
import { createScmProvider } from '../../../utils/scm';
import { Role } from '#shared/types';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'List recent commits for a cluster',
    description:
      'Returns recent commits for the failure cluster repository. Supports optional baseline query parameter for aggregate diff stats.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const [cluster] = await db.select().from(failureClusters).where(eq(failureClusters.id, id));
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

  const [run] = await db
    .select({ metadata: testRuns.metadata })
    .from(testRuns)
    .where(eq(testRuns.id, cluster.lastSeenRunId));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = run?.metadata as any;
  const repositoryUrl = normalizeGitUrl(meta?.scm?.remoteUrl ?? null);

  if (!repositoryUrl) return { commits: [], repositoryUrl: null, aggregate: null, error: null };

  const provider = await createScmProvider(repositoryUrl, db, cluster.projectId);
  if (!provider) return { commits: [], repositoryUrl, aggregate: null, error: null };

  const query = getQuery(event);
  const baselineSha = query.baseline as string | undefined;
  const branch = (query.branch as string | undefined) || undefined;
  const limit = Math.min(Math.max(parseInt(String(query.limit || '50')), 1), 200);

  const commits = await provider.listCommits(limit, branch);

  let error: string | null = null;
  if (commits.length === 0) {
    error = await provider.probeError(branch);
  }

  let aggregate: { filesChanged: number; linesAdded: number; linesRemoved: number } | null = null;
  if (baselineSha && commits.length > 0) {
    const latestSha = commits[0]!.sha;
    try {
      const diff = await provider.fetchChanges(baselineSha, latestSha);
      if (diff) {
        aggregate = {
          filesChanged: diff.files.length,
          linesAdded: diff.files.reduce((s, f) => s + f.additions, 0),
          linesRemoved: diff.files.reduce((s, f) => s + f.deletions, 0),
        };
      }
    } catch {
      /* stats unavailable */
    }
  }

  return { commits, repositoryUrl, aggregate, error, hasMore: commits.length >= limit };
});
