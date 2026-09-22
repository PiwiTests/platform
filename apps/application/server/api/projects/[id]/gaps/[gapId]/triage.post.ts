import { z } from 'zod';
import { getDatabase } from '../../../../../database';
import { requireProjectAccess, requireRouteId } from '../../../../../utils/project-access';
import { triageGap } from '#shared/handlers/scenario-gaps';

defineRouteMeta({
  openAPI: {
    tags: ['Scenario gaps'],
    summary: 'Triage a scenario gap',
    description:
      'Applies an inbox verb to a gap: `accept` (queues its draft), `snooze` (1-day / 1-week / until the node changes), `dismiss` with a reason (`not-worth-testing`, `covered-elsewhere` — which records a covering test as a manual reaches edge — or `wrong`), or `covered-by` (records a covering test without dismissing).',
    parameters: [
      { name: 'id', in: 'path', required: true, schema: { type: 'integer' } },
      { name: 'gapId', in: 'path', required: true, schema: { type: 'integer' } },
    ],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

const triageSchema = z.object({
  verb: z.enum(['accept', 'snooze', 'dismiss', 'covered-by']),
  snooze: z.enum(['1-day', '1-week', 'until-node-changes']).optional(),
  reason: z.enum(['not-worth-testing', 'covered-elsewhere', 'wrong']).optional(),
  coveringTestCaseId: z.number().int().optional().nullable(),
  assignedTo: z.string().optional().nullable(),
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  const gapId = requireRouteId(event, 'gapId', 'gap ID');
  await requireProjectAccess(event, projectId);
  const db = await getDatabase();

  const validation = triageSchema.safeParse(await readBody(event));
  if (!validation.success) {
    throw apiError({ statusCode: 400, message: 'Invalid triage', data: validation.error.issues });
  }

  const result = await triageGap(db, projectId, gapId, validation.data);
  if ('error' in result) {
    if (result.error === 'gap-not-found') throw apiError({ statusCode: 404, message: 'Gap not found' });
    throw apiError({ statusCode: 400, message: 'Covering test not found in this project' });
  }
  return { success: true, status: result.status };
});
