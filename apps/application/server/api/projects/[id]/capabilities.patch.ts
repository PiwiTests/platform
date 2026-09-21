import { z } from 'zod';
import { getDatabase } from '../../../database';
import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getProjectCapabilities, setProjectDecisions } from '#shared/handlers/capabilities';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Set project capability decisions',
    description:
      'Declines, enables or clears optional capabilities for one project. The body is `{ decisions }`, a map from capability id to `"declined"`, `"enabled"` (overriding an instance decline for this project) or `null` to clear. Returns the resolved project states after the change. Requires administrator role.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

const bodySchema = z.object({
  decisions: z.record(z.string(), z.union([z.literal('declined'), z.literal('enabled'), z.null()])),
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);
  const db = await getDatabase();

  const validation = bodySchema.safeParse(await readBody(event));
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid request body', data: validation.error.issues });
  }

  try {
    await setProjectDecisions(db, projectId, validation.data.decisions);
  } catch (e: any) {
    if (e?.message === 'Project not found') throw apiError({ statusCode: 404, message: 'Project not found' });
    throw e;
  }
  return getProjectCapabilities(db, projectId);
});
