import { getDatabase } from '../../database';
import { startDeviceConnect, CONNECT_RATE_LIMITS } from '../../utils/extension-connect';
import { checkRateLimit, rateLimitClientIp, rateLimitedError } from '../../utils/rate-limit';
import { resolvePublicBaseUrl } from '../../utils/oauth-helpers';

defineRouteMeta({
  openAPI: {
    tags: ['Extension'],
    summary: 'Start connecting the browser extension or an editor',
    description:
      'Starts an RFC 8628 device authorization for Piwi Picker, the VS Code extension or the JetBrains plugin. Answers a device code for the client to poll `/api/extension/connect/token` with, and a user code with the page where a signed-in user allows or denies the connection. The request expires after 10 minutes. Body: `{ browser?, os? }` from Piwi Picker or `{ editor, os? }` from an editor, which name the connecting client. Rate-limited per client address.',
    security: [],
    responses: {
      200: {
        description: 'The started request',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: {
                deviceCode: { type: 'string' },
                userCode: { type: 'string', example: 'BCDF-GHJK' },
                verificationUrl: { type: 'string' },
                interval: { type: 'integer', description: 'Seconds between polls' },
                expiresIn: { type: 'integer', description: 'Seconds until the request expires' },
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
  const rateKey = `extension-connect:start:${rateLimitClientIp(event)}`;
  if (!checkRateLimit(rateKey, CONNECT_RATE_LIMITS.start.limit, CONNECT_RATE_LIMITS.start.windowMs)) {
    throw rateLimitedError(event, [rateKey]);
  }
  const body = ((await readBody(event).catch(() => null)) ?? {}) as {
    browser?: unknown;
    editor?: unknown;
    os?: unknown;
  };
  const started = await startDeviceConnect(await getDatabase(), {
    browser: body.browser,
    editor: body.editor,
    os: body.os,
  });
  const siteUrl = (useRuntimeConfig(event).public as { siteUrl?: string })?.siteUrl;
  const url = getRequestURL(event);
  const base = resolvePublicBaseUrl(siteUrl, `${url.protocol}//${url.host}`);
  return {
    ...started,
    verificationUrl: `${base}/extension/connect?code=${encodeURIComponent(started.userCode)}`,
  };
});
