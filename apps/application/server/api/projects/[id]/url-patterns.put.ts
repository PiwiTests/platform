import { requireProjectAccess, requireRouteId } from '../../../utils/project-access';
import { getDatabase } from '../../../database';
import { replaceProjectUrlPatterns, urlPatternListSchema } from '#shared/handlers/url-patterns';
import { urlPatternWriteError } from '../../../utils/url-pattern-errors';

defineRouteMeta({
  openAPI: {
    tags: ['Projects'],
    summary: 'Replace a project’s URL patterns',
    description:
      'Body: `{ items: [{ pattern, environment?, branch? }] }`, in the order Piwi Picker tries them. Each pattern starts with `http://`, `https://` or a wildcard. 409 when a pattern appears twice.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'integer' } }],
    'x-required-roles': ['administrator'],
  },
});

export default eventHandler(async (event) => {
  const id = requireRouteId(event, 'id', 'project ID');
  await requireProjectAccess(event, id);
  const parsed = urlPatternListSchema.safeParse(await readBody(event));
  if (!parsed.success) throw apiError({ statusCode: 400, message: 'Invalid request body', data: parsed.error.issues });
  const result = await replaceProjectUrlPatterns(await getDatabase(), id, parsed.data.items);
  if (!result.ok) throw urlPatternWriteError(result);
  return { items: result.items };
});
