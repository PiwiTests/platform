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
