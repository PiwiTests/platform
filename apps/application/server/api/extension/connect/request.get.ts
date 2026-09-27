import { getDatabase } from '../../../database';
import { requireAuth } from '../../../utils/auth';
import { describeConnectRequest, CONNECT_RATE_LIMITS } from '../../../utils/extension-connect';
import { isRateLimited, rateLimitClientIp, rateLimitedError, recordRateLimitHit } from '../../../utils/rate-limit';

defineRouteMeta({
  openAPI: {
    tags: ['Extension'],
    summary: 'Describe a browser-extension connect request',
    description:
      'What the page at `/extension/connect` shows before the user allows or denies: the connecting client, the code, the expiry and the status (`pending`, `approved`, `denied`, `consumed` or `expired`). Query: `code`, the user code. Failed lookups are rate-limited.',
    parameters: [{ name: 'code', in: 'query', required: true, schema: { type: 'string' } }],
    'x-required-roles': ['administrator', 'reporter', 'user'],
  },
});

export default eventHandler(async (event) => {
  const user = await requireAuth(event);
  const missKey = `extension-connect:miss:${user.id}:${rateLimitClientIp(event)}`;
  if (isRateLimited(missKey, CONNECT_RATE_LIMITS.lookupMiss.limit)) throw rateLimitedError(event, [missKey]);
  const view = await describeConnectRequest(await getDatabase(), getQuery(event).code);
  if (!view) {
    recordRateLimitHit(missKey, CONNECT_RATE_LIMITS.lookupMiss.windowMs);
    throw apiError({ statusCode: 404, message: 'No connect request has this code' });
  }
  return view;
});
