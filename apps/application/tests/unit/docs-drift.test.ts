import { describe, test, expect } from 'vitest';
import { readFileSync, existsSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { MCP_TOOL_DEFS } from '#shared/mcp-tools';
import { FEATURE_NEED_DOCS, PIWI_FEATURE_GROUPS } from '#shared/piwi-features';
import { PIWI_ENV_VARS } from '#shared/piwi-env-vars';
import { sidebars } from '../../../docs/.vitepress/navigation';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..');
const read = (relative: string) => readFileSync(join(repoRoot, relative), 'utf8');

// Pages the docs build writes from a registry; they are gitignored, so they are
// only on disk once `docs:gen` has run, and a check skips them rather than fail.
const GENERATED_PAGES = new Set(['reference/configuration', 'reference/features', 'reference/whats-new']);

// The anchor VitePress gives a heading, as the app and the docs link to it.
const slug = (heading: string) =>
  heading
    .toLowerCase()
    .replace(/`/g, '')
    .replace(/\*\*/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[^\w\- ]+/g, '')
    .trim()
    .replace(/\s+/g, '-');

// Every anchor a docs page offers: its h2-h4 headings, a heading's own
// `{#id}`, and explicit `<a id="…">` targets.
const anchorsOf = (path: string) => {
  const contents = readFileSync(path, 'utf8');
  return [
    ...[...contents.matchAll(/^#{2,4} (.+)$/gm)].map((m) => {
      const custom = /\{#([\w-]+)\}\s*$/.exec(m[1]!);
      return custom ? custom[1]! : slug(m[1]!);
    }),
    ...[...contents.matchAll(/<a id="([\w-]+)"/g)].map((m) => m[1]!),
  ];
};

// Every Markdown page of the docs site, generated pages included once built.
const docsPages = (function walk(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === 'node_modules' || entry.name.startsWith('.')) return [];
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return walk(path);
    return entry.name.endsWith('.md') && entry.name !== 'AGENTS.md' ? [relative(repoRoot, path)] : [];
  });
})(join(repoRoot, 'apps/docs'));

// The one line the project describes itself with. AGENTS.md names the surfaces
// that must carry it; these are the ones that live in the repository.
const POSITIONING = [
  'CI throws away every report it makes.',
  'Piwi keeps them',
  'groups the failures by root cause',
  'scores the flaky tests',
  'finds the locator you should have used',
  'Self-hosted, MIT, zero telemetry',
];

const POSITIONING_SURFACES = ['README.md', 'DOCKER_HUB.md', 'apps/docs/index.md', 'apps/docs/.vitepress/config.mts'];

describe('positioning line', () => {
  test.each(POSITIONING_SURFACES)('%s carries every clause', (relative) => {
    // Prose wraps, so compare against a single-spaced copy: a clause split
    // across two source lines is still the same sentence to a reader.
    const contents = read(relative).replace(/\s+/g, ' ');
    for (const clause of POSITIONING) {
      expect(contents, `${relative} is missing "${clause}" — see AGENTS.md#documentation`).toContain(clause);
    }
  });
});

describe('documented counts', () => {
  // Every page on the docs site (the generated configuration.md included,
  // when built) plus the repository-level pages that repeat the number. The
  // generated What's new page repeats historical changelog counts (e.g. "from
  // 14 to 38 tools") that were correct for that release — it is the one place
  // stale numbers are the point, so it is not held to the live count.
  const countPages = [...docsPages, 'apps/docs/AGENTS.md'].filter((p) => p !== 'apps/docs/reference/whats-new.md');
  const COUNT_SURFACES = [...countPages, 'README.md', 'ROADMAP.md', 'DOCKER_HUB.md'];

  test.each(COUNT_SURFACES)('%s states the real MCP tool count, if it states one', (relative) => {
    for (const [claim, stated] of read(relative).matchAll(/\b(\d+) tools\b/g)) {
      expect(Number(stated), `${relative} says "${claim}", there are ${MCP_TOOL_DEFS.length}`).toBe(
        MCP_TOOL_DEFS.length,
      );
    }
  });

  test('every registered MCP tool is documented in apps/docs/features/mcp.md', () => {
    const contents = read('apps/docs/features/mcp.md');
    for (const { name } of MCP_TOOL_DEFS) {
      expect(contents, `apps/docs/features/mcp.md has no entry for \`${name}\``).toContain(`\`${name}\``);
    }
  });
});

describe('docs pages the app deep-links into', () => {
  // help-content.ts, the capability registry and a handful of components build
  // docs URLs from bare string literals that nothing else validates, so a
  // renamed heading breaks them silently in production.

  // Every .vue/.ts file under app/ and shared/ — any of them may carry a
  // `doc: '…'` registry field or a static `DocLink to="…"`.
  const walkSources = (dir: string): string[] =>
    readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walkSources(path);
      return /\.(vue|ts)$/.test(entry.name) ? [relative(repoRoot, path)] : [];
    });
  const sources = [
    ...walkSources(join(repoRoot, 'apps/application/app')),
    ...walkSources(join(repoRoot, 'apps/application/shared')),
  ];

  const targets = [
    ...new Set([
      ...sources.flatMap((source) => {
        const contents = read(source);
        return [
          ...[...contents.matchAll(/doc: '([^']+)'/g)].map((m) => m[1]!),
          ...[...contents.matchAll(/DocLink\s+to="([^"]+)"/g)].map((m) => m[1]!),
        ];
      }),
      // The All features page (apps/docs/reference/features.md) is generated from
      // this catalog, so every `doc` in it must resolve just like an in-app link.
      ...PIWI_FEATURE_GROUPS.flatMap((group) => group.features.map((feature) => feature.doc)),
      // The <Needs> chips link each prerequisite to its setup page.
      ...Object.values(FEATURE_NEED_DOCS),
      // The configuration reference links each variable to its details.
      ...Object.values(PIWI_ENV_VARS).flatMap((meta) => (meta.docs ? [meta.docs] : [])),
    ]),
  ];

  test('there are links to check', () => {
    expect(targets.length).toBeGreaterThan(0);
  });

  test.each(targets)('%s resolves to a page and heading', (target) => {
    const [page, anchor] = target.split('#');
    const path = join(repoRoot, 'apps/docs', `${page}.md`);
    if (GENERATED_PAGES.has(page!) && !existsSync(path)) return;

    expect(existsSync(path), `no apps/docs/${page}.md`).toBe(true);
    if (!anchor) return;

    expect(anchorsOf(path), `apps/docs/${page}.md has no heading anchored #${anchor}`).toContain(anchor);
  });
});

describe('single-source snippets', () => {
  // Shared blocks live once under apps/docs/snippets/ and are pulled into docs
  // pages with VitePress code includes (`<<< @/snippets/…`). Surfaces that
  // cannot include a file — the repo README, the npm package READMEs, the
  // Docker Hub page, and inline references in prose — carry a literal copy
  // instead; this guard fails when such a copy drifts from the canonical
  // snippet, the same way the positioning check keeps that one line in sync
  // across surfaces. The canonical text is compared trimmed, so a one-liner
  // embedded inline in a sentence still matches.
  const SNIPPET_COPIES: Record<string, readonly string[]> = {
    'apps/docs/snippets/fixtures.ts': ['README.md', 'packages/reporter/README.md'],
    'apps/docs/snippets/secret.sh': ['README.md', 'DOCKER_HUB.md', 'packages/server/README.md'],
  };

  for (const [snippet, surfaces] of Object.entries(SNIPPET_COPIES)) {
    const canonical = read(snippet).trim();
    test.each(surfaces)(`${snippet} → %s carries it verbatim`, (surface) => {
      expect(
        read(surface),
        `${surface} has drifted from ${snippet} — paste the snippet in byte for byte, or convert the surface to a VitePress include`,
      ).toContain(canonical);
    });
  }
});

describe('no leaked version history', () => {
  // Version history belongs on the generated What's new page (from the
  // changelog), not scattered through the feature pages as "since version X" /
  // "now supports Y" asides that go stale. This bans only the phrasings that are
  // unambiguously changelog-speak — "no longer" / "used to" / "previously" are
  // left out because they have too many legitimate uses ("a mark it no longer
  // needs", "the tags used to organize projects").
  const BANNED = [/\bsince version\b/i, /\bsince v\d/i, /\bnow supports\b/i];

  // Hand-written docs pages only: the generated pages (What's new is literally
  // the version history) and the blog essay are allowed to talk about releases.
  const pages = (function walk(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      if (entry.name === 'node_modules' || entry.name === 'blog' || entry.name.startsWith('.')) return [];
      const path = join(dir, entry.name);
      if (entry.isDirectory()) return walk(path);
      return entry.name.endsWith('.md') && entry.name !== 'AGENTS.md' ? [relative(repoRoot, path)] : [];
    });
  })(join(repoRoot, 'apps/docs')).filter((p) => ![...GENERATED_PAGES].some((gen) => p === `apps/docs/${gen}.md`));

  test.each(pages)('%s carries no changelog-speak', (page) => {
    const contents = read(page);
    for (const pattern of BANNED) {
      expect(pattern.test(contents), `${page} uses "${pattern.source}" — move it to the changelog / What's new`).toBe(
        false,
      );
    }
  });
});

describe('feature-page word budget', () => {
  // A feature page follows a fixed skeleton and stays short (the restructure
  // proposal's 1,200-word budget). This keeps a page from quietly growing back
  // into the grab-bag it was carved out of.
  const BUDGET = 1200;
  // Pages carved from the old grab-bags that are still over budget, pending the
  // remaining content splits (ai-diagnosis → clusters/diagnosis/fix-plans,
  // evidence flattened, ui-overview rewritten). Capped at their current size so
  // they can only shrink toward the budget, never grow — retire an entry once
  // its page is under BUDGET.
  const OVER_BUDGET: Record<string, number> = {
    'ai-diagnosis': 4800,
    evidence: 3700,
    'ui-overview': 3079,
    extension: 2500,
    mcp: 2300,
    'scenario-gaps': 1760,
    desktop: 2300,
    'locator-healing': 2000,
    notifications: 1400,
    'ai-steps': 1560,
    'test-selection': 2063,
  };

  const featurePages = readdirSync(join(repoRoot, 'apps/docs/features')).filter((f) => f.endsWith('.md'));

  test.each(featurePages)('features/%s is within budget', (file) => {
    // The page as a reader sees it: the front matter is metadata, not reading.
    const body = read(`apps/docs/features/${file}`).replace(/^---\n[\s\S]*?\n---\n/, '');
    const words = body.trim().split(/\s+/).length;
    const cap = OVER_BUDGET[file.replace(/\.md$/, '')] ?? BUDGET;
    expect(
      words,
      `apps/docs/features/${file} is ${words} words (cap ${cap}) — trim it${cap === BUDGET ? '' : ', and lower its OVER_BUDGET cap'}`,
    ).toBeLessThanOrEqual(cap);
  });
});

describe('docs site structure', () => {
  // The feature catalog is the site's one grouping: the Features sidebar, the
  // landing cards and the All features page are all rendered from it, so a
  // feature page it does not list is a page no reader can find by browsing.
  const catalogPages = new Set(
    PIWI_FEATURE_GROUPS.flatMap((group) => group.features.map((feature) => feature.doc.split('#')[0])),
  );
  const featurePages = docsPages
    .filter((p) => p.startsWith('apps/docs/features/'))
    .map((p) => p.replace(/^apps\/docs\//, '').replace(/\.md$/, ''));

  test.each(featurePages)('%s is an entry in the feature catalog', (page) => {
    expect(catalogPages.has(page), `${page} is missing from shared/piwi-features.ts`).toBe(true);
  });

  // The description is the page's search snippet and its social-card text.
  test.each(docsPages)('%s has a description', (page) => {
    const frontMatter = /^---\n([\s\S]*?)\n---\n/.exec(read(page))?.[1] ?? '';
    expect(frontMatter, `${page} has no description in its front matter`).toMatch(/^description: \S/m);
  });

  // A page has one name: its sidebar label is its H1. A recipe is the
  // exception, since its H1 is the question the reader arrives with.
  const h1Of = (path: string) =>
    /^# (.+)$/m.exec(
      readFileSync(path, 'utf8')
        .replace(/^---\n[\s\S]*?\n---\n/, '')
        .replace(/```[\s\S]*?```/g, ''),
    )?.[1];
  const sidebarEntries = [
    ...new Map(
      Object.values(sidebars())
        .flat()
        .flatMap((group) => group.items)
        .filter((item) => item.link.startsWith('/'))
        .map((item) => [`${item.link} ${item.text}`, [item.link, item.text] as const]),
    ).values(),
  ];

  test.each(sidebarEntries)('sidebar entry %s resolves to a page titled "%s"', (link, text) => {
    const [route, anchor] = link.split('#');
    const page = route!.replace(/^\//, '').replace(/\/$/, '/index');
    const path = join(repoRoot, 'apps/docs', `${page}.md`);
    if (GENERATED_PAGES.has(page) && !existsSync(path)) return;

    expect(existsSync(path), `the sidebar links ${link}, and there is no apps/docs/${page}.md`).toBe(true);
    if (anchor) {
      expect(anchorsOf(path), `apps/docs/${page}.md has no heading anchored #${anchor}`).toContain(anchor);
      return;
    }
    if (page.startsWith('recipes/')) return;
    expect(h1Of(path), `apps/docs/${page}.md: the H1 and the sidebar label differ`).toBe(text);
  });

  // The READMEs and the Docker Hub page link into the site from outside it, so
  // nothing but this check notices when a page or heading they point at moves.
  const SURFACES = [
    'README.md',
    'DOCKER_HUB.md',
    'ROADMAP.md',
    ...readdirSync(join(repoRoot, 'packages')).map((dir) => `packages/${dir}/README.md`),
    ...readdirSync(join(repoRoot, 'integrations')).map((dir) => `integrations/${dir}/README.md`),
    'apps/extension/README.md',
    'apps/desktop/README.md',
  ].filter((surface) => existsSync(join(repoRoot, surface)));
  const surfaceLinks = [
    ...new Set(
      SURFACES.flatMap((surface) =>
        [...read(surface).matchAll(/https:\/\/piwitests\.dev(\/[^\s)"'<>`]*)?/g)]
          .map((m) => m[1] ?? '/')
          // The demo is the app itself, and files under public/ are not pages.
          .filter((url) => !url.startsWith('/demo') && !/\.[a-z0-9]+(#.*)?$/i.test(url))
          .map((url) => `${surface} ${url}`),
      ),
    ),
  ];

  test.each(surfaceLinks)('%s resolves to a page and heading', (entry) => {
    const [surface, url] = entry.split(' ');
    const [route, anchor] = url!.split('#');
    const page = route!.replace(/^\//, '').replace(/\/$/, '') || 'index';
    const path = [`${page}.md`, `${page}/index.md`].map((file) => join(repoRoot, 'apps/docs', file)).find(existsSync);
    if (GENERATED_PAGES.has(page) && !path) return;

    expect(path, `${surface} links ${url}, and the docs have no such page`).toBeDefined();
    if (!anchor) return;
    expect(anchorsOf(path!), `${surface} links ${url}, and the page has no such heading`).toContain(anchor);
  });
});
