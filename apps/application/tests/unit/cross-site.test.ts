import { describe, test, expect } from 'vitest';
import { isCrossSiteWrite } from '../../server/utils/cross-site';

describe('isCrossSiteWrite', () => {
  test('refuses state-changing requests a browser sends from another site', () => {
    expect(isCrossSiteWrite({ method: 'POST', secFetchSite: 'cross-site', origin: 'https://evil.example' })).toBe(true);
    expect(isCrossSiteWrite({ method: 'DELETE', secFetchSite: 'same-site', origin: 'https://a.example.com' })).toBe(
      true,
    );
    expect(isCrossSiteWrite({ method: 'patch', secFetchSite: 'cross-site', origin: null })).toBe(true);
  });

  test('allows reads, same-origin requests and requests without browser metadata', () => {
    expect(isCrossSiteWrite({ method: 'GET', secFetchSite: 'cross-site' })).toBe(false);
    expect(isCrossSiteWrite({ method: 'OPTIONS', secFetchSite: 'cross-site' })).toBe(false);
    expect(isCrossSiteWrite({ method: 'POST', secFetchSite: 'same-origin' })).toBe(false);
    expect(isCrossSiteWrite({ method: 'POST', secFetchSite: 'none' })).toBe(false);
    expect(isCrossSiteWrite({ method: 'POST' })).toBe(false);
  });

  test('allows the browser extension', () => {
    expect(isCrossSiteWrite({ method: 'POST', secFetchSite: 'cross-site', origin: 'chrome-extension://abc' })).toBe(
      false,
    );
    expect(isCrossSiteWrite({ method: 'PUT', secFetchSite: 'cross-site', origin: 'moz-extension://uuid' })).toBe(false);
  });
});
