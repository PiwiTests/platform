// Desktop-only: the window's answer to a pairing, behind the desktop token like
// every other route.
import { requireAuth } from '../../../utils/auth';
import { apiError } from '../../../utils/api-error';
import { answerPairing } from '../../../utils/desktop-pairing';

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Allow or deny a Piwi Picker pairing (desktop app)',
    description:
      'Desktop build only — 404 on the server build. Body: `{ allow: boolean }`. The window sends it when the developer answers the pairing it shows. 404 when the pairing is gone or already answered.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  if (!process.env.PIWI_DESKTOP_TOKEN) {
    throw apiError({ statusCode: 404, message: 'Desktop build only' });
  }
  await requireAuth(event);
  const body = (await readBody(event).catch(() => null)) as { allow?: unknown } | null;
  if (typeof body?.allow !== 'boolean') throw apiError({ statusCode: 400, message: 'allow must be true or false' });
  const answered = answerPairing(getRouterParam(event, 'id') ?? '', body.allow);
  if (!answered) throw apiError({ statusCode: 404, message: 'Pairing not found or already answered' });
  return answered;
});
