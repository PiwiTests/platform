/**
 * Generates apps/docs/reference/whats-new.md — the "what's new" page — from the
 * repository CHANGELOG.md.
 *
 * The page is a build artifact (gitignored): `docs:dev` and `docs:build` run
 * this first, so it can never drift from the changelog. It lists the *feature*
 * entries (release-please's `### Features`) grouped by minor version, newest
 * first, with commit links stripped — the answer to "what changed since I last
 * upgraded". Bug fixes and the full history stay in CHANGELOG.md, linked at the
 * top. To change the page, cut a release; do not edit it here.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
// here = apps/docs/scripts → up three to the monorepo root, where CHANGELOG.md lives.
const monorepoRoot = join(here, '..', '..', '..');
const changelog = readFileSync(join(monorepoRoot, 'CHANGELOG.md'), 'utf8');

const RELEASE = /^## \[(\d+)\.(\d+)\.(\d+)\][^\n]*?\((\d{4}-\d{2}-\d{2})\)/;
const SECTION = /^### (.+)/;
const BULLET = /^\* (.+)/;
// Trailing release-please commit link(s): ` ([abc1234](https://…/commit/…))`.
const COMMIT_LINK = /\s*\(\[[0-9a-f]{7,}\]\([^)]*\)\)/g;

/** One entry per minor version (X.Y), newest first, with its feature list. */
const minors = new Map();
const keyOf = (major, minor) => `${major}.${minor}`;

let current = null; // { key, sortKey } for the release being read
let inFeatures = false;

for (const line of changelog.split('\n')) {
  const release = RELEASE.exec(line);
  if (release) {
    const [, major, minor, patch, date] = release;
    const key = keyOf(major, minor);
    if (!minors.has(key)) {
      minors.set(key, { major: +major, minor: +minor, date, features: [], seen: new Set() });
    }
    const entry = minors.get(key);
    // The minor's own date is its .0 release; a changelog is newest-first, so
    // prefer the .0 date when we reach it and otherwise keep the earliest seen.
    if (patch === '0' || date < entry.date) entry.date = date;
    current = entry;
    inFeatures = false;
    continue;
  }
  const section = SECTION.exec(line);
  if (section) {
    inFeatures = section[1].trim() === 'Features';
    continue;
  }
  if (!current || !inFeatures) continue;
  const bullet = BULLET.exec(line);
  if (!bullet) continue;
  const subject = bullet[1].replace(COMMIT_LINK, '').trim();
  if (subject && !current.seen.has(subject)) {
    current.seen.add(subject);
    current.features.push(subject);
  }
}

const ordered = [...minors.values()]
  .filter((m) => m.features.length > 0)
  .sort((a, b) => b.major - a.major || b.minor - a.minor);

const sections = ordered
  .map((m) => [`## ${m.major}.${m.minor} — ${m.date}`, '', ...m.features.map((f) => `- ${f}`), ''].join('\n'))
  .join('\n');

const page = `---
title: What's new
lang: en-US
editLink: false
---

<!-- GENERATED FILE — do not edit. -->
<!-- Source of truth: CHANGELOG.md, rendered by apps/docs/scripts/generate-whats-new.mjs (npm run docs:gen). -->

# What's new

The features that landed in each release, newest first — the answer to "what
changed since I last upgraded, and is any of it worth reading about". It is
generated from the project [changelog](https://github.com/PiwiTests/platform/blob/main/CHANGELOG.md),
which also holds the bug fixes and the full commit history.

Piwi is pre-1.0: minor releases can carry breaking changes and the database
schema moves with them, so read [Upgrading](/operate/upgrading) before you bump a tag.

${sections}`;

mkdirSync(join(here, '..', 'reference'), { recursive: true });
writeFileSync(join(here, '..', 'reference', 'whats-new.md'), page);
console.log(`generated apps/docs/reference/whats-new.md from ${ordered.length} minor versions`);
