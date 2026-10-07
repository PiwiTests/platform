import { afterEach, describe, expect, it, vi } from 'vitest';
import { hostPattern, originPattern } from '../../src/shared/web-origin.js';

const CHROME_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36';
const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:143.0) Gecko/20100101 Firefox/143.0';

function asBrowser(userAgent: string): void {
  vi.stubGlobal('navigator', { userAgent });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('hostPattern', () => {
  it('keeps the port in Chrome', () => {
    asBrowser(CHROME_UA);
    expect(hostPattern('http://localhost:3000')).toBe('http://localhost:3000/*');
    expect(hostPattern('https://piwi.example')).toBe('https://piwi.example/*');
  });

  it('leaves the port out in Firefox, whose patterns with a port match nothing', () => {
    asBrowser(FIREFOX_UA);
    expect(hostPattern('http://localhost:3000')).toBe('http://localhost/*');
    expect(hostPattern('http://127.0.0.1:47211')).toBe('http://127.0.0.1/*');
    expect(hostPattern('http://[::1]:3000')).toBe('http://[::1]/*');
    expect(hostPattern('https://piwi.example')).toBe('https://piwi.example/*');
  });
});

describe('originPattern', () => {
  it('is the host pattern of the page origin, null for a page that is not http or https', () => {
    asBrowser(FIREFOX_UA);
    expect(originPattern('http://localhost:5173/cart?id=1')).toBe('http://localhost/*');
    expect(originPattern('about:blank')).toBeNull();
    expect(originPattern(null)).toBeNull();
  });
});
