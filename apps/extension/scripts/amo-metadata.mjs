// Builds the add-on's addons.mozilla.org listing in the shape AMO's add-on API
// takes, which is also what `web-ext sign --amo-metadata` sends (see
// PUBLISHING.md §4 c).
//
// AMO reads only three listing fields from the add-on itself: the name, the
// summary (the manifest `description`) and the homepage (`homepage_url`),
// translated through `_locales/`. Everything else comes from `store/`: the
// short fields in `amo-listing.json`, and one Markdown file per language for
// the description, named after its `_locales/` directory. The summary is taken
// from `_locales/` here too, so each text has one source.
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));

const readJson = (file) => JSON.parse(readFileSync(path.join(root, file), 'utf8'));
const readText = (file) => readFileSync(path.join(root, file), 'utf8').trim();

/** AMO's code for a `_locales/` directory: `en` is `en-US` there, and `pt_BR` is `pt-BR`. */
const amoLocale = (dir) => (dir === 'en' ? 'en-US' : dir.replace('_', '-'));

export function buildAmoMetadata() {
  const manifest = readJson('manifest.json');
  const listing = readJson('store/amo-listing.json');
  const summary = {};
  const description = {};
  for (const dir of readdirSync(path.join(root, 'public', '_locales')).sort()) {
    const locale = amoLocale(dir);
    summary[locale] = readJson(`public/_locales/${dir}/messages.json`).extDescription.message;
    description[locale] = readText(`store/amo-description.${dir}.md`);
  }
  return {
    ...listing,
    default_locale: amoLocale(manifest.default_locale),
    name: { [amoLocale(manifest.default_locale)]: manifest.name },
    summary,
    description,
    homepage: { [amoLocale(manifest.default_locale)]: manifest.homepage_url },
    version: { ...listing.version, approval_notes: readText('store/amo-reviewer-notes.md') },
  };
}
