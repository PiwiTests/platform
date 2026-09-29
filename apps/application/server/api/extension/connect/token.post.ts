import { getDatabase } from '../../../database';
import { pollDeviceConnect, CONNECT_RATE_LIMITS } from '../../../utils/extension-connect';
import { checkRateLimit, rateLimitClientIp, rateLimitedError } from '../../../utils/rate-limit';

defineRouteMeta({
  openAPI: {
    tags: ['Extension'],
    summary: 'Poll a browser-extension connect request',
    description:
      'Body: `{ deviceCode }`. Answers `{ status }`: `pending` until a user decides, `slow_down` (with a longer `interval`) when polled faster than the interval, `denied`, `expired`, or `approved` with `apiKey` and `user`. The key is created for the user who allowed the request and is returned by the first poll that sees it approved, never again; with authentication off it is empty. Rate-limited per client address.',
    'x-required-roles': [],
    security: [],
    responses: {
      200: {
        description: 'The request status',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                status: { type: 'string', enum: ['pending', 'slow_down', 'denied', 'expired', 'approved'] },
                interval: { type: 'integer' },
                apiKey: { type: 'string' },
                user: { type: 'object', nullable: true, properties: { name: { type: 'string' } } },
              },
            },
          },
        },
      },
      429: { description: 'Too many requests from this address' },
    },
  },
});

export default eventHandler(async (event) => {
  const rateKey = `extension-connect:token:${rateLimitClientIp(event)}`;
  if (!checkRateLimit(rateKey, CONNECT_RATE_LIMITS.token.limit, CONNECT_RATE_LIMITS.token.windowMs)) {
    throw rateLimitedError(event, [rateKey]);
  }
  const body = ((await readBody(event).catch(() => null)) ?? {}) as { deviceCode?: unknown };
  setResponseHeader(event, 'Cache-Control', 'no-store');
  return pollDeviceConnect(await getDatabase(), body.deviceCode);
});
