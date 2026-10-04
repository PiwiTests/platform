import { LANGUAGE_KEY, isLanguage, type Language, type LanguageChoice, type RawCatalog } from '../shared/i18n.js';

/**
 * The background worker's half of the Language setting: the chosen catalog
 * is read from the extension's own package and stored beside the choice, for
 * every page and script to read with `initI18n()`. `_locales/` stays out of
 * `web_accessible_resources`, so no page can probe for the extension.
 */

/** Reads a shipped catalog from the extension's own package. Extension pages and the worker only. */
async function readPackagedCatalog(code: Language): Promise<RawCatalog> {
  const response = await fetch(chrome.runtime.getURL(`_locales/${code}/messages.json`));
  if (!response.ok) throw new Error(`_locales/${code}/messages.json: ${response.status}`);
  return (await response.json()) as RawCatalog;
}

/**
 * Stores the Options choice with its catalog, or clears it for `null`. Run
 * by the background worker, which answers the Options page's request.
 */
export async function storeLanguageChoice(
  code: Language | null,
  read: (code: Language) => Promise<RawCatalog> = readPackagedCatalog,
): Promise<void> {
  if (code === null) {
    await chrome.storage.local.remove(LANGUAGE_KEY);
    return;
  }
  const choice: LanguageChoice = { code, messages: await read(code) };
  await chrome.storage.local.set({ [LANGUAGE_KEY]: choice });
}

/**
 * Reads the stored choice's catalog again from the package, so an update
 * never shows the texts of the version before it. A language no longer
 * shipped goes back to following the browser.
 */
export async function refreshLanguageChoice(
  read: (code: Language) => Promise<RawCatalog> = readPackagedCatalog,
): Promise<void> {
  const stored = (await chrome.storage.local.get(LANGUAGE_KEY))[LANGUAGE_KEY] as Partial<LanguageChoice> | undefined;
  if (!stored) return;
  await storeLanguageChoice(isLanguage(stored.code) ? stored.code : null, read);
}
