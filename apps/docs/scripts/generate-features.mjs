/**
 * Generates apps/docs/reference/feature-map.md — the feature map — from the
 * feature catalog (apps/application/shared/piwi-features.ts).
 *
 * The page is a build artifact (gitignored): `docs:dev` and `docs:build` run
 * this first, so the map can never drift from the catalog. To change the page,
 * edit the catalog. Every `doc` target in the catalog is resolved against a
 * real page + heading by apps/application/tests/unit/docs-drift.test.ts.
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { createJiti } from 'jiti';

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '..', '..');
const jiti = createJiti(import.meta.url);

const { PIWI_FEATURE_GROUPS, FEATURE_NEED_LABELS } = await jiti.import(
  join(repoRoot, 'application/shared/piwi-features.ts'),
);

const cell = (text) => text.replace(/\|/g, '\\|');

/** Extra prerequisites, or "reporter" when a feature needs nothing more. */
const needs = (list) => (list.length === 0 ? 'reporter' : list.map((n) => FEATURE_NEED_LABELS[n]).join(', '));

const featureRow = ({ title, summary, needs: need, where, doc }) =>
  `| [${cell(title)}](/${doc}) | ${cell(summary)} | ${cell(needs(need))} | ${cell(where)} |`;

function groupMarkdown({ title, intro, features }) {
  return [
    `## ${title}`,
    '',
    intro,
    '',
    '| Feature | What it does | Needs | Where |',
    '|---------|--------------|-------|-------|',
    ...features.map(featureRow),
    '',
  ].join('\n');
}

const total = PIWI_FEATURE_GROUPS.reduce((n, g) => n + g.features.length, 0);

const page = `---
title: Feature map
lang: en-US
editLink: false
---

<!-- GENERATED FILE — do not edit. -->
<!-- Source of truth: apps/application/shared/piwi-features.ts, rendered by apps/docs/scripts/generate-features.mjs (npm run docs:gen). -->

# Feature map

Everything Piwi does, in one place — what each feature is, what it needs beyond
a running [reporter](/guide/reporter), where it lives in the dashboard, and the
page that explains it. Features are grouped by the three jobs the product serves:
**keep the history**, **explain the failures**, and **hand back a fix** — plus how
you reach them from elsewhere and what an operator runs.

New here? Start with [What Piwi does](/guide/what-piwi-does) and [Getting started](/guide/getting-started); this map is the "where next" once a first run has landed.

${PIWI_FEATURE_GROUPS.map(groupMarkdown).join('\n')}`;

mkdirSync(join(here, '..', 'reference'), { recursive: true });
writeFileSync(join(here, '..', 'reference', 'feature-map.md'), page);
console.log(`generated apps/docs/reference/feature-map.md from ${total} features`);
