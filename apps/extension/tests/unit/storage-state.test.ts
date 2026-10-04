import { describe, it, expect } from 'vitest';
import {
  cookieOriginPatterns,
  setupSnippet,
  toStorageState,
  type BrowserCookie,
} from '../../src/shared/storage-state.js';

const cookie = (fields: Partial<BrowserCookie>): BrowserCookie => ({
  name: 'sid',
  value: 'abc',
  domain: 'shop.test',
  path: '/',
  secure: true,
  httpOnly: true,
  sameSite: 'lax',
  session: true,
  ...fields,
});

describe('toStorageState', () => {
  it('writes the cookies as Playwright reads them', () => {
    const state = toStorageState(
      [
        cookie({}),
        cookie({
          name: 'prefs',
          domain: '.shop.test',
          httpOnly: false,
          session: false,
          expirationDate: 1_900_000_000.7,
        }),
        cookie({ name: 'cross', sameSite: 'no_restriction' }),
        cookie({ name: 'strict', sameSite: 'strict' }),
        cookie({ name: 'any', sameSite: 'unspecified' }),
      ],
      'https://shop.test',
      [],
    );
    expect(state.cookies[0]).toEqual({
      name: 'sid',
      value: 'abc',
      domain: 'shop.test',
      path: '/',
      expires: -1,
      httpOnly: true,
      secure: true,
      sameSite: 'Lax',
    });
    expect(state.cookies[1]).toMatchObject({ domain: '.shop.test', expires: 1_900_000_000, httpOnly: false });
    expect(state.cookies.map((c) => c.sameSite)).toEqual(['Lax', 'Lax', 'None', 'Strict', 'Lax']);
    expect(state.origins).toEqual([]);
  });

  it('keeps each cookie once, and the origin’s localStorage', () => {
    const state = toStorageState([cookie({}), cookie({})], 'https://shop.test', [['token', 'xyz']]);
    expect(state.cookies).toHaveLength(1);
    expect(state.origins).toEqual([{ origin: 'https://shop.test', localStorage: [{ name: 'token', value: 'xyz' }] }]);
  });
});

describe('setupSnippet', () => {
  it('saves and uses the file at the path Playwright’s guide names', () => {
    expect(setupSnippet()).toContain("await page.context().storageState({ path: 'playwright/.auth/user.json' });");
    expect(setupSnippet()).toContain("test.use({ storageState: 'playwright/.auth/user.json' });");
  });
});

describe('cookieOriginPatterns', () => {
  it('asks for the host for both schemes and any port', () => {
    expect(cookieOriginPatterns('localhost')).toEqual(['*://localhost/*']);
    expect(cookieOriginPatterns('127.0.0.1')).toEqual(['*://127.0.0.1/*']);
    expect(cookieOriginPatterns('[::1]')).toEqual(['*://[::1]/*']);
    expect(cookieOriginPatterns('shop.test')).toEqual(['*://shop.test/*']);
  });

  it('asks for each parent domain a cookie can be set on, never a public suffix', () => {
    expect(cookieOriginPatterns('App.Example.com')).toEqual(['*://app.example.com/*', '*://example.com/*']);
    expect(cookieOriginPatterns('a.b.example.co.uk')).toEqual([
      '*://a.b.example.co.uk/*',
      '*://b.example.co.uk/*',
      '*://example.co.uk/*',
    ]);
    expect(cookieOriginPatterns('shop.example.com.au.')).toEqual(['*://shop.example.com.au/*', '*://example.com.au/*']);
  });
});
