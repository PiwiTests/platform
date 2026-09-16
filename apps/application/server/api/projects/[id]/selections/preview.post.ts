import { requireProjectAccess, requireRouteId } from '../../../../utils/project-access';
import { getDatabase } from '../../../../database';
import { resolveSelectionDefinition } from '#shared/handlers/selections';
import { validateSelectionDefinition, type SelectionDefinition, type SelectionFormat } from '#shared/selection';

const FORMATS: SelectionFormat[] = ['args', 'grep', 'files', 'json'];

defineRouteMeta({
  openAPI: {
    tags: ['Selections'],
    summary: 'Preview an ad-hoc selection definition',
    description:
      'Resolves a definition supplied in the request body without saving it — the builder’s live preview and an agent’s dry-run both use this. Returns the same shape as the resolve endpoint.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
    requestBody: {
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: { definition: { type: 'object' }, format: { type: 'string', enum: FORMATS } },
            required: ['definition'],
          },
        },
      },
    },
  },
});

export default eventHandler(async (event) => {
  const projectId = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, projectId);

  const body = (await readBody(event)) as { definition?: unknown; format?: unknown };
  const check = validateSelectionDefinition(body.definition);
  if (!check.valid) throw apiError({ statusCode: 400, message: `Invalid definition: ${check.errors.join('; ')}` });

  const format = FORMATS.includes(body.format as SelectionFormat) ? (body.format as SelectionFormat) : 'args';

  const db = await getDatabase();
  return resolveSelectionDefinition(db, projectId, body.definition as SelectionDefinition, { format });
});
