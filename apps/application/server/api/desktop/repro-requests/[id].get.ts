import { requireAuth } from '../../../utils/auth';
import { apiError } from '../../../utils/api-error';
import { getReproRequest } from '../../../utils/desktop-repro';

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Read a repro request (desktop app)',
    description:
      'Desktop build only — 404 on the server build. The request, its status (`waiting`, `running`, `done`, `declined`, `expired`) and, once done, the verdict of the Playwright run: `reproduced` at a step with the value found, `not-reproduced`, `diverged` at a step with the reason, `completed` (nothing expected) or `stopped`. Readable ten minutes after its last change.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  if (!process.env.PIWI_DESKTOP_TOKEN) {
    throw apiError({ statusCode: 404, message: 'Desktop build only' });
  }
  await requireAuth(event);
  const request = getReproRequest(getRouterParam(event, 'id') ?? '');
  if (!request) throw apiError({ statusCode: 404, message: 'Repro request not found' });
  return request;
});
