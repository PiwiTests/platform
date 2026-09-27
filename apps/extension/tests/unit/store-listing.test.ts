import { describe, it, expect } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..', '..');
const manifest = JSON.parse(readFileSync(path.join(root, 'manifest.json'), 'utf8'));
const localesDir = path.join(root, 'public', '_locales');
const locales = readdirSync(localesDir).sort();
const messages = (locale: string): Record<string, { message: string }> =>
  JSON.parse(readFileSync(path.join(localesDir, locale, 'messages.json'), 'utf8'));

/** Every `__MSG_name__` the manifest refers to. */
const manifestMessages = [...JSON.stringify(manifest).matchAll(/__MSG_(\w+)__/g)].map((m) => m[1]!);

describe('store listing', () => {
  it('has the default locale among its translations', () => {
    expect(locales).toContain(manifest.default_locale);
  });

  it('defines every message the manifest uses, in every language', () => {
    for (const locale of locales) {
      for (const name of manifestMessages) expect(messages(locale)[name]?.message, `${locale}: ${name}`).toBeTruthy();
    }
  });

  it('keeps the summary within 132 characters, the Chrome Web Store’s limit', () => {
    // Longer is fine for AMO (250), but the Chrome Web Store rejects the upload.
    for (const locale of locales) expect([...messages(locale).extDescription!.message].length).toBeLessThanOrEqual(132);
  });

  it('has an AMO description for every language', () => {
    // `scripts/amo-metadata.mjs` pairs each `_locales/` directory with its file.
    for (const locale of locales)
      expect(existsSync(path.join(root, 'store', `amo-description.${locale}.md`))).toBe(true);
  });
});
