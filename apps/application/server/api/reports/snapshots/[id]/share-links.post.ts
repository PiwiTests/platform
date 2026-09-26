import { z } from 'zod';
import { getDatabase } from '../../../../database';
import { requireAuth } from '../../../../utils/auth';
import { getProjectScope, requireRouteId } from '../../../../utils/project-access';
import { reportRoute } from '../../../../utils/reports/context';
import { mintShareLink } from '../../../../utils/share-links';
import { mintedShareLinkResponse, requireShareLinksEnabled } from '../../../../utils/share-view';
import { getReportSnapshot } from '#shared/handlers/reports';

defineRouteMeta({
  openAPI: {
    tags: ['Reports'],
    summary: 'Create a share link for a report snapshot',
    description:
      'Mints a read-only public link to this stored quality report, with its `badge.svg` and `chart.png` beside it. The full token is returned once and stored only as a hash. The caller must be able to open every project the snapshot covers. Requires PIWI_SHARE_LINKS_ENABLED=true.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const bodySchema = z.object({ ttlDays: z.number().int().min(1).max(3650).nullish() });

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const id = requireRouteId(event, 'id', 'snapshot ID');
  const db = await getDatabase();
  await reportRoute(async () => getReportSnapshot(db as any, id, await getProjectScope(db, user as any)));
  requireShareLinksEnabled();

  const validation = bodySchema.safeParse((await readBody(event).catch(() => null)) ?? {});
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }
  const minted = await mintShareLink(db, {
    projectId: null,
    entityKind: 'report',
    entityId: id,
    createdBy: user.id || null,
    ttlDays: validation.data.ttlDays,
  });
  return mintedShareLinkResponse(event, minted);
});
