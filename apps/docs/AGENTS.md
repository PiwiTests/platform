# Documentation site — agent guide

Rules for working inside `apps/docs/` (the VitePress site published to GitHub Pages). Read [`../AGENTS.md`](../AGENTS.md)
first — in particular the **cross-platform shell commands** rule, which applies to every snippet on this site.

```bash
npm run docs:dev      # local preview (runs docs:gen first)
npm run docs:build    # production build (runs docs:gen first)
npm run docs:gen      # regenerate the derived pages only
```

## Generated pages — never edit them by hand

`docs:gen` writes three pages from registries. They are **gitignored** and rebuilt by `docs:dev` and `docs:build`:

| Page | Source | Script |
|---|---|---|
| `reference/configuration.md` | the env-var registry, `apps/application/shared/piwi-env-vars.ts` | `scripts/generate-configuration.mjs` |
| `reference/features.md` (All features) | the feature catalog, `apps/application/shared/piwi-features.ts` | `scripts/generate-features.mjs` |
| `reference/whats-new.md` | `CHANGELOG.md` | `scripts/generate-whats-new.mjs` |

### The configuration reference

- To change a variable's name, description, default or category → edit the **registry**.
- To change section prose or ordering → edit `PIWI_ENV_CATEGORIES` (title/intro/note/order; `mergeInto` folds one
  category's table into another; `internal` hides harness-only vars).
- The interactive generator at `/reference/configuration/generator` reads the **same registry** through the `#shared` Vite alias
  wired in `apps/docs/.vitepress/config.mts`, and emits output through the pure emitters in `apps/application/shared/env-format.ts`
  (unit-tested quoting for .env / compose / docker run / K8s / systemd / shell). Change the emitters, not the markup.
- Keep the section anchors stable (`#general`, `#wasted-time` are deep-linked from the app and other pages).

### The API reference

There is **no `apps/docs/api.md`, and you must not create one.** The auto-generated OpenAPI spec (`/_openapi.json`) and the
self-contained in-app reference at `/docs` in the running app are the single source of truth for API documentation —
the in-app page renders the spec with no third-party CDN, so it works offline and air-gapped.

When documenting a feature here, link to the live demo reference
(`[API docs](https://piwitests.dev/demo/docs)`) and refer to the self-hosted reference as inline code
`/docs` rather than inlining endpoint descriptions. Do **not** write a bare `[API docs](/docs)` markdown link:
`/docs` is a route on the running app, not a page on this docs site, so VitePress's dead-link check fails the
build. Endpoint documentation is
authored in the handler's `defineRouteMeta({ openAPI: … })` block — see
[`../application/AGENTS.md`](../application/AGENTS.md#openapi-annotations).

## Site structure (MUST follow)

### One grouping: the feature catalog

The feature catalog (`apps/application/shared/piwi-features.ts`) is the only place features are grouped. Three things
are rendered from it, so never restate its lists by hand:

- the **Features sidebar**, by `featuresSidebar()` in `.vitepress/navigation.ts`: one group per catalog group, one
  entry per catalog entry whose page is under `features/`;
- the **landing page's cards**, one per catalog group, set by `transformPageData` in `.vitepress/config.mts`;
- the **All features** page, `reference/features.md`.

The top navigation and the Guide, Self-hosting and Reference sidebars are plain data in `.vitepress/navigation.ts`,
which the drift test also reads.

| Section | Folder | The question the reader is holding |
|---|---|---|
| Guide → Get started | `guide/` | "How do I get a first run in, and what do these words mean?" |
| Guide → Set up | `guide/` | "How do I connect my suite, my CI, and what a feature needs?" |
| Guide → About Piwi | `guide/` | "What is this, and should I adopt it?" |
| Features | `features/`, `recipes/` | "What does this feature do, and how do I use it?", grouped by catalog group |
| Self-hosting | `operate/` | "I run the server." |
| Reference | `reference/` | "What are all the values?" |

### Where a new page goes

- **A new feature** adds a catalog entry and one page under `features/`. The entry's `title` is the page's H1 and its
  sidebar label, so the feature has one name everywhere. Never extend another feature's page with it. A page stays
  single-purpose: if it needs two sentences to say what it is for, it is two pages (`storage` + `database` was one).
- **A prerequisite**, anything a `<Needs>` chip names, gets a setup page in Guide → Set up, and the chip links there
  through `FEATURE_NEED_DOCS` in the catalog.
- **An operator task** goes in `operate/`. An install path is not an operations page: the desktop app is a way of
  getting a dashboard, so it is a feature page. A page with no server dependency at all, the browser extension, is
  never an operations page either.
- **A list of a code registry's entries** is a reference page, generated from the registry rather than written by hand.
- **A recipe** goes in `recipes/` and into `RECIPES_BY_GROUP` in `.vitepress/navigation.ts`, at the top of the catalog
  group it serves.
- **A page that moves** keeps its old URL working with a row in `public/404.html`; GitHub Pages has no server-side
  redirects.

### Every page

- A `description` in its front matter: one sentence, used as the search snippet and the social card text.
- Its H1 equals its sidebar label. Recipes are the exception: their H1 is the reader's question.
- One footer heading, `## Related`.
- A new term goes into `concepts.md` in the change that introduces it.
- The page describes what a default install does today. Planned work belongs in `ROADMAP.md`; an experimental
  feature gets one short section marked **Experimental**, with a link to its proposal.

### `recipes/` — task-first pages

Every other page is organized by feature. `recipes/` is organized by the question a reader arrives
with ("did I break this, or is it flaky?"), and each page crosses several features to answer one. It
exists for the long-tail searches that never contain the word "Piwi", so:

- **One question per page**, phrased as the reader would phrase it — that phrasing is the H1.
- **Feature pages stay the source of truth.** A recipe links to them; it never becomes a second place
  where the flaky score or the fingerprint algorithm is explained, because that copy will drift.
- **Always give a route for readers who can't install the thing.** State what a step requires (capture
  fixtures, an LLM key, a browser extension, a signed-installer-less desktop build) and offer the
  alternative — dashboard, MCP, REST API, or plain trace evidence. Listing a requirement without an
  alternative is the failure mode to avoid.
- **A recipe opens the Features group it serves**, through `RECIPES_BY_GROUP`, and the landing page's *Something is
  red right now* list links every recipe. There is no recipes index page.
- Recipes reuse **existing committed screenshots**; add a scene to the feature-screenshot harness only
  if a recipe genuinely needs a screen no page shows yet.

- **`concepts.md` is the vocabulary source of truth** — project / test run / **test case** (a test's identity across
  time) / **execution** (one attempt, one browser — the `test_runs_cases` row) / failure cluster / fingerprint /
  baseline. Use those words consistently in docs *and* UI copy; link the anchor instead of redefining a term.
- **`ui-overview.md` is a map, not a manual** — one short paragraph per view plus a link to the page that explains the
  concept. Feature explanations belong on the feature page. It is the page most likely to accrete a manual, because a
  feature with no home lands here by default: if you catch yourself adding an H3, a screenshot or a table to it, the
  feature needs its own page instead (`evidence` and `offline-export` were both extracted from it).
- **Contributor material does not belong on this site.** Build steps, source layout, migration workflow and dev
  commands live in `CONTRIBUTING.md` / `AGENTS.md` / `packages/reporter/ARCHITECTURE.md`. The site is for people *using* Piwi.
- **Every user-visible reporter option** must appear in `reporter.md`'s options table (and its `PIWI_*` var in the
  table below it) in the same change that adds it to `packages/reporter/src/public/options.ts`.
- **In-app help links point here.** `apps/application/app/utils/help-content.ts` builds docs URLs from `doc:` string
  literals, as do the capability registry, a few components via `<DocLink to="…">`, the catalog, its
  `FEATURE_NEED_DOCS` and the env-var registry's `docs` fields. `apps/application/tests/unit/docs-drift.test.ts`
  resolves every one of them against the headings on this site, so renaming a heading turns that test red rather
  than breaking a help link silently — but the fix is still yours: update the literal, or keep the anchor.

### What the drift test checks

`apps/application/tests/unit/docs-drift.test.ts` fails when a docs link the code builds points at a missing page or
heading, a link between two docs pages points at a missing page or heading, a `features/` page is missing from the
catalog, a page has no `description`, a sidebar entry points at a missing page or differs from that page's H1, or a
docs URL in `README.md`, `DOCKER_HUB.md`, `ROADMAP.md` or a package or integration README points at a missing page or
heading. It also guards the positioning line, the MCP tool count, the single-source snippets, changelog wording on
hand-written pages and the feature-page word budget.

The docs build itself only fails on a link to a missing page, and pull requests do not run it, so this test is what
catches a heading that moved. It computes anchors the way VitePress does (`headingAnchor` in `.vitepress/navigation.ts`);
when you move a section, keep its heading text or update every link the test names.


## Writing conventions

- Update the affected page **in the same commit** as the code change; commit scope `docs`.
- American English, sentence-case headings, and the shell-portability rule from the root guide: VitePress uses
  `::: code-group` with ```bash [Linux / macOS] + ```powershell [Windows (PowerShell)] tabs when a command has no
  portable single form.
- Diagrams are theme-aware SVG assets under `apps/docs/public/` — commit the asset rather than embedding a large inline
  `<svg>` in prose.

### Voice

Informative, specific, honest — never promotional. Piwi is not a product being sold. The canonical positioning line
and the seven surfaces that must carry it are in the [root guide](../AGENTS.md#documentation).

- **Banned**: conversion CTA blocks ("Stop losing your…" + buttons), `for-the-badge` call-to-action badges, "try it
  now" / pointing-hand CTAs, competitor feature tables with a **Price** row in the README (honest prose comparison
  belongs in `comparison.md`), vanity badges (stars), superlatives ("powerful", "seamless", "unlock",
  "best-in-class"), and more than ~8 feature bullets or cards on any one page — past that nobody reads them.
- **Prefer the concrete over the categorical**: "groups forty red tests into three root causes" beats "observability
  platform". Name a number, a behavior, or a limit.
- **State limits plainly.** Playwright-only, pre-1.0, and "not the right tool if…" belong in the README and on the
  landing page. Trust is the point, not a caveat to bury.

## Marketing screenshots

The **light/dark diagonal split** is a scene option, not a manual procedure: `split: true` captures the scene in both
themes at the same viewport and scroll position and composites them — light above the top-right → bottom-left seam,
dark below — so a hero recaptures with one command like any other illustration:

```bash
cd apps/application
npm run app:screens -- home
```

Pair it with `deviceScaleFactor: 2` and `outputWidth` to write a crisp image at the width the page actually gives it:
the docs gallery's featured tile spans the content column (~1152px), and anything wider is bytes the reader never sees.

The gallery images that are still live-demo captures (`projects.png`, `test-run.png`, the failure-cluster set) are
**1280×720**, taken against `https://piwitests.dev/demo/` with the `playwright-cli` skill and the demo banner
hidden via `.demo-banner{display:none!important}`. Give them a scene when you next touch one — the harness renders
icons offline and pins the clock, which the live demo cannot.

Demo *evidence* media (the screenshots, traces and videos shown inside the product) is a different pipeline — see
[`../application/AGENTS.md`](../application/AGENTS.md#demo-evidence-media-committed-binaries).

**Feature illustrations** (a docs page showing a specific screen, including desktop-only UI the live demo cannot
render) come from the feature-screenshot harness instead. Every one of them has a scene that writes it, and the scene
name is the file name, so recapturing takes only the name:

```bash
cd apps/application
npm run app:screens -- flaky-detection   # one illustration
npm run app:screens:docs                 # all of them
npm run app:screens:check                # every image has a scene, every scene has its image
```

Add a scene to the script's `SCENES` registry if none fits, tagged `docs` with `out: 'docs'`; target the screen through
a `data-shot` attribute rather than a DOM path, and leave `mode` at its `web` default unless the illustration is of the
desktop shell (`mode: 'desktop'` runs it against a desktop-enabled server with the mocked Tauri bridge, no shell build
needed). Images written this way are committed — keep the scene current so the illustration can be recaptured when the
UI changes, and run `app:screens:check` after adding or deleting one.

A gallery image with no marketing-specific treatment (no diagonal split) belongs to a scene rather than the live-demo
pipeline: the harness renders icons from the bundled collection and can be re-run offline, so the image stays
reproducible as the UI moves.

The hero/gallery images above are **not** produced by the harness; they are listed in its `EXTERNAL_DOCS_IMAGES` set so
the check knows to leave them alone. `ai-diagnosis.png` stays there too — it needs a configured AI provider.
