import { describe, expect, it } from 'vitest';
import type { H3Event } from 'h3';
import { presentsDesktopToken } from '../../server/utils/desktop-access';

const TOKEN = 'pd_desktop_token';

/** A request carrying just these headers. */
function withHeaders(headers: Record<string, string>): H3Event {
  return { context: {}, node: { req: { headers }, res: {} } } as unknown as H3Event;
}

describe('the desktop access token', () => {
  it('is accepted from the cookie, a bearer, the x-piwi-token header and the X-API-Key header', () => {
    expect(presentsDesktopToken(withHeaders({ cookie: `piwi_token=${TOKEN}` }), TOKEN)).toBe(true);
    expect(presentsDesktopToken(withHeaders({ authorization: `Bearer ${TOKEN}` }), TOKEN)).toBe(true);
    expect(presentsDesktopToken(withHeaders({ 'x-piwi-token': TOKEN }), TOKEN)).toBe(true);
    expect(presentsDesktopToken(withHeaders({ 'x-api-key': TOKEN }), TOKEN)).toBe(true);
  });

  it('is refused when absent or wrong, whichever header carries it', () => {
    expect(presentsDesktopToken(withHeaders({}), TOKEN)).toBe(false);
    expect(presentsDesktopToken(withHeaders({ 'x-api-key': 'pd_other' }), TOKEN)).toBe(false);
    expect(presentsDesktopToken(withHeaders({ authorization: 'Bearer pd_other' }), TOKEN)).toBe(false);
  });
});
