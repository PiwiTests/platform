import { failureClusters, testRuns } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { normalizeGitUrl } from '../../../utils/scm/git-url';
import { createScmProvider } from '../../../utils/scm';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get commit diff for a cluster',
    description: 'Returns the file changes and patches for a specific commit SHA in the cluster repository.',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      {
        name: 'sha',
        in: 'query',
        required: true,
        schema: { type: 'string' },
        description: 'Commit SHA to diff.',
      },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const sha = getQuery(event).sha as string | undefined;
  if (!sha) throw apiError({ statusCode: 400, message: 'Missing sha query parameter' });

  const [cluster] = await db
    .select({
      id: failureClusters.id,
      projectId: failureClusters.projectId,
      lastSeenRunId: failureClusters.lastSeenRunId,
    })
    .from(failureClusters)
    .where(eq(failureClusters.id, id));
  if (!cluster) throw apiError({ statusCode: 404, message: 'Failure cluster not found' });

  const [run] = await db
    .select({ metadata: testRuns.metadata })
    .from(testRuns)
    .where(eq(testRuns.id, cluster.lastSeenRunId));

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const meta = run?.metadata as any;
  const repositoryUrl = normalizeGitUrl(meta?.scm?.remoteUrl ?? null);
  if (!repositoryUrl) return null;

  const provider = await createScmProvider(repositoryUrl, db, cluster.projectId);
  if (!provider) return null;

  return provider.fetchCommitDiff(sha);
});
