import {
  requireResolvedProjectAccess,
  requireRouteId,
  resolveTestRunCaseProjectId,
} from '../../../utils/project-access';
import { listEntityShareLinks } from '../../../utils/share-links';

defineRouteMeta({
  openAPI: {
    tags: ['Test Run Cases'],
    summary: 'List share links for one execution',
    description: 'Returns the share links minted for this execution — prefixes and lifecycle only, never the tokens.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'test run case ID');
  const { db } = await requireResolvedProjectAccess(event, id, resolveTestRunCaseProjectId, 'Test run case');
  return { items: await listEntityShareLinks(db, 'execution', id) };
});
