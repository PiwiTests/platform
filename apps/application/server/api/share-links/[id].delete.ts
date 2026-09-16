import { requireProjectAccess, requireRouteId } from '../../utils/project-access';
import { getShareLink, revokeShareLink } from '../../utils/share-links';
import { getDatabase } from '../../database';

defineRouteMeta({
  openAPI: {
    tags: ['Share Links'],
    summary: 'Revoke a share link',
    description: 'Revokes a share link immediately. The row is kept for the audit trail.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'share link ID');
  const db = await getDatabase();
  const link = await getShareLink(db, id);
  if (!link) {
    throw apiError({ statusCode: 404, message: 'Share link not found' });
  }
  await requireProjectAccess(event, link.projectId);
  await revokeShareLink(db, id);
  return { success: true };
});
