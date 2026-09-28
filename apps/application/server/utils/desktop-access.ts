import type { H3Event } from 'h3';
import { timingSafeEqualStr } from './timing-safe';

/**
 * Whether the request presents the desktop access token `token`, as any of:
 *   - the `piwi_token` cookie the app window obtains via `/__piwi/session`
 *     (rides along on SSR-internal fetches and EventSource streams),
 *   - an `Authorization: Bearer <token>` header (the Playwright reporter, whose
 *     `pd_`-prefixed token goes through its API-key path), or
 *   - an `x-piwi-token` header.
 */
export function presentsDesktopToken(event: H3Event, token: string): boolean {
  const authz = getRequestHeader(event, 'authorization');
  const bearer = authz && authz.startsWith('Bearer ') ? authz.slice('Bearer '.length) : undefined;
  const presented = getCookie(event, 'piwi_token') || getRequestHeader(event, 'x-piwi-token') || bearer;
  return !!presented && timingSafeEqualStr(presented, token);
}

/**
 * The routes the desktop guard leaves open, without the token: the readiness
 * probe the shell polls before the window has a cookie, and Piwi Picker's
 * pairing start and poll, which it sends before it holds the token. Each of
 * the two checks for itself who may ask (`shared/desktop-pairing.ts`).
 */
export function isOpenDesktopRoute(method: string, path: string): boolean {
  const pathname = path.split('?')[0]!;
  if (pathname === '/api/health') return true;
  if (method === 'POST' && pathname === '/api/desktop/picker-pairings') return true;
  return method === 'GET' && /^\/api\/desktop\/picker-pairings\/[0-9a-f]{16}$/.test(pathname);
}
