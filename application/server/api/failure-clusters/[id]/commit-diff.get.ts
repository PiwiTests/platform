import { requireAuth } from '../../../utils/auth';
import { getDatabase } from '../../../database';
import { failureClusters, testRuns } from '../../../database/schema';
import { eq } from 'drizzle-orm';
import { normalizeGitUrl } from '../../../utils/regression-context';
import { createScmProvider } from '../../../utils/scm';
import { Role } from '../../../../shared/types';

const REQUIRED_ROLES: Role[] = [Role.ADMINISTRATOR, Role.REPORTER, Role.USER];

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Get commit diff for a cluster',
    description: 'Returns the file changes and patches for a specific commit SHA in the cluster repository.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': REQUIRED_ROLES,
  },
});

export default eventHandler(async (event) => {
  await requireAuth(event);
  const id = parseInt(getRouterParam(event, 'id') || '0');
  if (!id) throw createError({ statusCode: 400, message: 'Invalid cluster ID' });

  const sha = getQuery(event).sha as string | undefined;
  if (!sha) throw createError({ statusCode: 400, message: 'Missing sha query parameter' });

  const db = await getDatabase();
  const [cluster] = await db
    .select({
      id: failureClusters.id,
      projectId: failureClusters.projectId,
      lastSeenRunId: failureClusters.lastSeenRunId,
    })
    .from(failureClusters)
    .where(eq(failureClusters.id, id));
  if (!cluster) throw createError({ statusCode: 404, message: 'Failure cluster not found' });

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
