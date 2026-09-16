import { eq } from 'drizzle-orm';
import { failureClusters } from '../../../database/schema';
import { requireResolvedProjectAccess, requireRouteId, resolveClusterProjectId } from '../../../utils/project-access';
import { ciRerunAvailability, dispatchClusterRerun } from '../../../utils/ci-rerun';
import type { ClusterRerunDispatch } from '#shared/ci-rerun';
import type { ScmProviderName } from '#shared/scm-urls';

defineRouteMeta({
  openAPI: {
    tags: ['Failure Clusters'],
    summary: 'Re-run a cluster in CI',
    description:
      "Dispatches a CI workflow/pipeline to re-run exactly the cluster's affected tests, using the project's SCM token and the configured CI re-run target. Returns the provider's runs URL.",
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'cluster ID');
  const { db, user } = await requireResolvedProjectAccess(event, id, resolveClusterProjectId, 'Failure cluster');

  const [cluster] = await db
    .select({
      id: failureClusters.id,
      projectId: failureClusters.projectId,
      lastSeenRunId: failureClusters.lastSeenRunId,
    })
    .from(failureClusters)
    .where(eq(failureClusters.id, id));
  if (!cluster) throw apiError({ statusCode: 404, message: 'Failure cluster not found' });

  // Re-check availability here so the API is safe on its own — the button's
  // disabled state is a convenience, not the boundary.
  const availability = await ciRerunAvailability(db, cluster.projectId, cluster.lastSeenRunId);
  if (!availability.available) {
    throw apiError({ statusCode: 400, message: availability.reason ?? 'CI re-run is not available for this cluster' });
  }

  let dispatch: { url: string; args: string; provider: ScmProviderName };
  try {
    dispatch = await dispatchClusterRerun(db, cluster);
  } catch (e) {
    throw apiError({ statusCode: 502, message: e instanceof Error ? e.message : 'CI re-run dispatch failed' });
  }

  const record: ClusterRerunDispatch = {
    provider: dispatch.provider,
    url: dispatch.url,
    args: dispatch.args,
    at: Date.now(),
    byName: user.name || user.username || null,
    byUserId: user.id,
  };
  await db
    .update(failureClusters)
    .set({ lastRerunDispatch: record, updatedAt: new Date() })
    .where(eq(failureClusters.id, cluster.id));

  return { ok: true, dispatch: record };
});
