import { afterEach, describe, expect, it, vi } from 'vitest';
import { isExtensionContext, moveLegacySecret, secretArea } from '../../src/shared/secret-store.js';
import { memorySecretArea } from './memory-secret-area.js';

afterEach(() => vi.unstubAllGlobals());

function runningAt(href: string): void {
  vi.stubGlobal('location', new URL(href));
  (globalThis as any).chrome = { runtime: { getURL: (path: string) => `chrome-extension://abc${path}` } };
}

describe('the secret area', () => {
  it('belongs to the extension’s own pages and its worker', () => {
    runningAt('chrome-extension://abc/options.html');
    expect(isExtensionContext()).toBe(true);
  });

  it('is refused to a content script, whose IndexedDB is the page’s', () => {
    runningAt('https://shop.test/cart');
    expect(isExtensionContext()).toBe(false);
    expect(() => secretArea()).toThrow();
  });

  it('moving a secret writes it before the local copy goes, and keeps one already there', async () => {
    const area = memorySecretArea();
    const order: string[] = [];
    const strip = async () => void order.push('strip');
    const set = area.set;
    area.set = async (name, value) => {
      order.push('set');
      await set(name, value);
    };
    await moveLegacySecret(area, 'desktop', { url: 'a', token: 'b' }, strip);
    expect(order).toEqual(['set', 'strip']);
    await moveLegacySecret(area, 'desktop', { url: 'c', token: 'd' }, strip);
    expect(area.data.get('desktop')).toEqual({ url: 'a', token: 'b' });
    expect(order).toEqual(['set', 'strip', 'strip']);
  });
});
