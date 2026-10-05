// Desktop-only: Piwi Picker polls its pairing. Open without the desktop token,
// but answers only with the secret the start gave the extension; the token
// goes out once, on the first poll after the developer's Allow.
import { apiError } from '../../../utils/api-error';
import { pollPairing } from '../../../utils/desktop-pairing';

defineRouteMeta({
  openAPI: {
    tags: ['System'],
    summary: 'Read a Piwi Picker pairing (desktop app)',
    description:
      'Desktop build only — 404 on the server build. Open without the desktop token; needs the secret the start answered, in `x-pairing-secret` (404 otherwise, as for an unknown pairing). Answers `{ status }`: `waiting`, `denied`, `expired` or `claimed`, and once, after the developer allowed it, `{ status: "allowed", token }` with the app’s access token.',
    parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
    security: [],
  },
});

export default eventHandler((event) => {
  const token = process.env.PIWI_DESKTOP_TOKEN;
  if (!token) throw apiError({ statusCode: 404, message: 'Desktop build only' });
  setResponseHeader(event, 'cache-control', 'no-store');
  const secret = getRequestHeader(event, 'x-pairing-secret') ?? '';
  const answer = pollPairing(getRouterParam(event, 'id') ?? '', secret, token);
  if (!answer) throw apiError({ statusCode: 404, message: 'Pairing not found' });
  return answer;
});
