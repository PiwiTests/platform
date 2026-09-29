import { readFileSync } from 'node:fs';
import path from 'node:path';
import { beforeEach } from 'vitest';
import { substitutePlaceholders, type RawCatalog } from '../../src/shared/i18n.js';

/**
 * Installs `chrome.i18n` for every unit test, backed by the real catalogs in
 * `public/_locales/`, English by default. Tests replace `globalThis.chrome`
 * with their own fakes, so `chrome` is an accessor that hands `i18n` to each
 * new fake that has none. {@link setBrowserLanguage} plays a browser set to
 * another language; every test starts in English.
 */

const localesDir = path.resolve(import.meta.dirname, '..', '..', 'public', '_locales');
const catalogs = new Map<string, Map<string, RawCatalog[string]>>();

export function readCatalog(code: string): RawCatalog {
  return JSON.parse(readFileSync(path.join(localesDir, code, 'messages.json'), 'utf8')) as RawCatalog;
}

function catalog(code: string): Map<string, RawCatalog[string]> {
  let entries = catalogs.get(code);
  if (!entries) {
    entries = new Map(Object.entries(readCatalog(code)).map(([name, entry]) => [name.toLowerCase(), entry]));
    catalogs.set(code, entries);
  }
  return entries;
}

let browser = { catalog: 'en', uiLanguage: 'en-US' };

/** The browser's catalog directory (`fr`) and the language it reports (`fr-FR`). */
export function setBrowserLanguage(code: string, uiLanguage = code): void {
  browser = { catalog: code, uiLanguage };
}

const i18n = {
  // Like the browser: the message in its language, else in the default locale, else ''.
  getMessage(name: string, substitutions?: string | string[]): string {
    const entry = catalog(browser.catalog).get(name.toLowerCase()) ?? catalog('en').get(name.toLowerCase());
    if (!entry) return '';
    const values = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
    return substitutePlaceholders(entry, values.map(String));
  },
  getUILanguage: () => browser.uiLanguage,
};

let current: Record<string, unknown> = { i18n };
Object.defineProperty(globalThis, 'chrome', {
  configurable: true,
  get: () => current,
  set(value: Record<string, unknown>) {
    current = value;
    if (value && typeof value === 'object' && !('i18n' in value)) value.i18n = i18n;
  },
});

beforeEach(() => setBrowserLanguage('en', 'en-US'));
