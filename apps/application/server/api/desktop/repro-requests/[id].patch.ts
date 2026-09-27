import { requireAuth } from '../../../utils/auth';
import { apiError } from '../../../utils/api-error';
import { updateReproRequest } from '../../../utils/desktop-repro';
import { reproRequestPatchSchema } from '#shared/desktop-repro';

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Record what the window did with a repro request (desktop app)',
    description:
      'Desktop build only — 404 on the server build. The window records that the developer started the request in a linked project (`running`), declined it (`declined`), or that its run ended (`done`, with the verdict and the Piwi run). 409 when the request is not in a state that step follows from.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  if (!process.env.PIWI_DESKTOP_TOKEN) {
    throw apiError({ statusCode: 404, message: 'Desktop build only' });
  }
  await requireAuth(event);
  const parsed = reproRequestPatchSchema.safeParse(await readBody(event));
  if (!parsed.success) throw apiError({ statusCode: 400, message: 'Invalid body', data: parsed.error.issues });
  const updated = updateReproRequest(getRouterParam(event, 'id') ?? '', parsed.data);
  if (!updated) throw apiError({ statusCode: 409, message: 'The repro request is gone or not in that state' });
  return updated;
});
