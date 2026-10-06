// Desktop-only: Piwi Picker asks to pair with this app. Open without the
// desktop token (the extension has none yet), so it answers only an
// extension's JSON request, keeps at most three pairings waiting, and hands
// nothing over: the window shows the request with its code, and only the
// developer's Allow there lets the extension's poll receive the token.
// Responds 404 on the normal server build.
import { apiError } from '../../utils/api-error';
import { pairingListenerCount, startPairing } from '../../utils/desktop-pairing';
import { PAIRING_POLL_SECONDS, PAIRING_TTL_MS, checkPairingStart, pairingClient } from '#shared/desktop-pairing';

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Ask to pair Piwi Picker with the desktop app (desktop app)',
    description:
      'Desktop build only — 404 on the server build. Open without the desktop token: answers only a request whose `Origin` is a browser extension’s (403 otherwise) and whose body is `application/json` (415 otherwise). Body: `{ browser?, os? }`, which name the asking client. Shows the pairing in the app window with its code, for the developer to allow or deny; at most three wait at once (429). Answers `{ id, secret, code, interval, expiresIn, windowOpen }`; poll `GET /api/desktop/picker-pairings/:id` with the secret in `x-pairing-secret`.',
    security: [],
    responses: {
      201: { description: 'The pairing, waiting for the developer' },
      403: { description: 'Not asked by a browser extension' },
      415: { description: 'The body is not JSON' },
      429: { description: 'Three pairings are waiting already' },
    },
  },
});

export default eventHandler(async (event) => {
  if (!process.env.PIWI_DESKTOP_TOKEN) {
    throw apiError({ statusCode: 404, message: 'Desktop build only' });
  }
  const check = checkPairingStart(getRequestHeader(event, 'origin'), getRequestHeader(event, 'content-type'));
  if (!check.ok) throw apiError({ statusCode: check.statusCode, message: check.message });
  const client = pairingClient(await readBody(event).catch(() => null));

  const started = startPairing({ source: check.source, client });
  if (!started.ok) throw apiError({ statusCode: 429, message: 'Three pairings are waiting already' });
  setResponseStatus(event, 201);
  return {
    id: started.pairing.id,
    secret: started.secret,
    code: started.pairing.code,
    interval: PAIRING_POLL_SECONDS,
    expiresIn: PAIRING_TTL_MS / 1000,
    windowOpen: pairingListenerCount() > 0,
  };
});
