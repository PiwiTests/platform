// Local-access guard for the desktop (Tauri) build.
//
// Inert unless the desktop shell sets PIWI_DESKTOP_TOKEN, so it has zero effect
// on the server / Docker / npx deployments. When active, every /api and /mcp
// request must carry the per-install access token, presented as any of:
//   - the `piwi_token` cookie the shell obtains via /__piwi/session (used by the
//     window — rides along on SSR-internal fetches and EventSource streams,
//     exactly like the auth session cookie),
//   - an `Authorization: Bearer <token>` header (used by the Playwright reporter
//     via its `apiKey` option — the token is `pd_`-prefixed so the reporter's
//     existing API-key path sends it as a bearer), or
//   - an `x-piwi-token` header.
// Combined with the loopback-only bind, this keeps the bundled server reachable
// only by the app itself and by tools the user has given the token to — not by
// other local processes or web pages open in the user's browser.
import { timingSafeEqualStr } from '../utils/timing-safe';

export default defineEventHandler((event) => {
  const token = process.env.PIWI_DESKTOP_TOKEN;
  if (!token) return; // not the desktop build — no-op

  const path = event.path || '';
  if (!path.startsWith('/api/') && !path.startsWith('/mcp')) return;
  // The readiness probe carries no token (the shell polls it before the window
  // has a cookie) and exposes nothing sensitive — leave it open.
  if (path === '/api/health') return;

  const authz = getRequestHeader(event, 'authorization');
  const bearer = authz && authz.startsWith('Bearer ') ? authz.slice('Bearer '.length) : undefined;
  const presented = getCookie(event, 'piwi_token') || getRequestHeader(event, 'x-piwi-token') || bearer;
  if (presented && timingSafeEqualStr(presented, token)) return;

  throw apiError({ statusCode: 401, statusMessage: 'Desktop access token required' });
});
