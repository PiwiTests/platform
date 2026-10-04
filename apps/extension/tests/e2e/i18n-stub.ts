import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { BrowserContext } from '@playwright/test';
import { substitutePlaceholders, type RawCatalog } from '../../src/shared/i18n.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const LOCALES = path.join(here, '..', '..', 'public', '_locales');

/** The catalog of `code` as it ships in `public/_locales`. */
export function readCatalog(code: string): RawCatalog {
  return JSON.parse(readFileSync(path.join(LOCALES, code, 'messages.json'), 'utf8')) as RawCatalog;
}

function installI18n(
  seed: { messages: RawCatalog; fallback: RawCatalog; uiLanguage: string },
  substitute: typeof substitutePlaceholders,
): void {
  const lower = (catalog: RawCatalog) =>
    new Map(Object.entries(catalog).map(([name, entry]) => [name.toLowerCase(), entry] as const));
  const messages = lower(seed.messages);
  const fallback = lower(seed.fallback);
  const g = globalThis as { chrome?: Record<string, unknown> };
  g.chrome ??= {};
  g.chrome.i18n = {
    getMessage(name: string, substitutions?: string | string[]): string {
      const entry = messages.get(name.toLowerCase()) ?? fallback.get(name.toLowerCase());
      if (!entry) return '';
      const values = substitutions === undefined ? [] : Array.isArray(substitutions) ? substitutions : [substitutions];
      return substitute(entry, values.map(String));
    },
    getUILanguage: () => seed.uiLanguage,
  };
}

/**
 * Adds `chrome.i18n` to a stubbed `chrome`, backed by the real catalog of
 * `language` (English by default) with the browser's fallback to English.
 * For the specs that run a bundle in the page's main world with a fake
 * `chrome`: call it after the init script that installs that fake, since
 * init scripts run in the order they were added.
 */
export async function stubChromeI18n(context: BrowserContext, language = 'en', uiLanguage = language): Promise<void> {
  const seed = { messages: readCatalog(language), fallback: readCatalog('en'), uiLanguage };
  await context.addInitScript(
    `(${installI18n.toString()})(${JSON.stringify(seed)}, ${substitutePlaceholders.toString()});`,
  );
}
