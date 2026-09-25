import { z } from 'zod';
import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { dashboardActor, dashboardRoute } from '../../../utils/dashboards';
import { mintShareLink } from '../../../utils/share-links';
import { mintedShareLinkResponse, requireShareLinksEnabled, savedDashboardId } from '../../../utils/share-view';
import { loadDashboardDefinition } from '#shared/handlers/dashboards';

defineRouteMeta({
  openAPI: {
    tags: ['Analytics'],
    summary: 'Create a live dashboard link',
    description:
      'Mints a read-only public link that renders this saved dashboard as a quality report computed at every view and reloading itself every minute, for a wall screen or a bookmark without a session, with its `badge.svg` and `chart.png` beside it. The numbers are computed with the project access of the caller, re-checked at every view, so the link dies with that access, with the dashboard, or at its expiry or revocation. It never serves evidence files. The full token is returned once and stored only as a hash. Requires PIWI_SHARE_LINKS_ENABLED=true.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

const bodySchema = z.object({ ttlDays: z.number().int().min(1).max(3650).nullish() });

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const db = await getDatabase();
  const id = savedDashboardId(event);
  await dashboardRoute(() => loadDashboardDefinition(db as any, String(id), dashboardActor(event, user as any)));
  requireShareLinksEnabled();

  const validation = bodySchema.safeParse((await readBody(event).catch(() => null)) ?? {});
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }
  const minted = await mintShareLink(db, {
    projectId: null,
    entityKind: 'dashboard',
    entityId: id,
    createdBy: user.id || null,
    ttlDays: validation.data.ttlDays,
  });
  return mintedShareLinkResponse(event, minted);
});
