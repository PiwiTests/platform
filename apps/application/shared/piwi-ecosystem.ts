/**
 * What Piwi is made of, the decisions a setup involves, and where feedback goes.
 *
 * The registry behind the MCP `describe_piwi` tool and the "The pieces" and
 * "Choosing a setup" sections of the generated feature map
 * (`apps/docs/reference/feature-map.md`, built by
 * `apps/docs/scripts/generate-features.mjs`), so the tool never says anything
 * the docs site does not. Kept short on purpose: each entry names a page that
 * holds the detail.
 *
 * Dependency-free like the feature catalog, so the docs generator imports it
 * with no app runtime. `docs-drift.test.ts` resolves every `doc` target against
 * a real page and heading, and holds `POSITIONING` to the canonical line.
 */
import type { FeatureNeed } from '#shared/piwi-features';

/** The canonical positioning line — one of the surfaces listed in the root AGENTS.md. */
export const POSITIONING = {
  name: 'Piwi',
  tagline: 'Your Playwright results, kept and explained.',
  summary:
    'CI throws away every report it makes. Piwi keeps them — then groups the failures by root cause, scores the flaky tests, and finds the locator you should have used. Self-hosted, MIT, zero telemetry.',
} as const;

const REPOSITORY = 'https://github.com/piwitests/platform';

export const PROJECT_LINKS = {
  docs: 'https://piwitests.dev',
  demo: 'https://piwitests.dev/demo/',
  apiReference: 'https://piwitests.dev/demo/docs',
  repository: REPOSITORY,
  releases: `${REPOSITORY}/releases`,
  changelog: `${REPOSITORY}/blob/main/CHANGELOG.md`,
  roadmap: `${REPOSITORY}/blob/main/ROADMAP.md`,
  contributing: `${REPOSITORY}/blob/main/CONTRIBUTING.md`,
  issues: `${REPOSITORY}/issues`,
  discussions: `${REPOSITORY}/discussions`,
} as const;

/** One installable or reachable part of the Piwi ecosystem. */
export interface EcosystemPiece {
  id: string;
  name: string;
  /** One or two sentences: what it is and what it does. */
  summary: string;
  /** How to get it — a command, a package or a place. */
  get: string;
  /** When a team needs it. */
  when: string;
  /** Extra prerequisites, in the feature catalog's vocabulary. */
  needs: FeatureNeed[];
  /** Docs page (+ optional `#anchor`), resolved by `docs-drift.test.ts`. */
  doc: string;
}

export const ECOSYSTEM_PIECES: EcosystemPiece[] = [
  {
    id: 'server',
    name: 'Dashboard server',
    summary:
      'The dashboard, its REST API and the MCP server in one Node process. It keeps runs in SQLite (default) or PostgreSQL and files on local disk (default) or S3-compatible storage.',
    get: 'The Docker image `phenx/piwitests-server` (also `ghcr.io/piwitests/platform`), `npx @piwitests/server`, a one-click deploy template, or the desktop app.',
    when: 'Always — every result lands in one. Where to run it is the first setup decision.',
    needs: [],
    doc: 'operate/deployment',
  },
  {
    id: 'desktop',
    name: 'Desktop app',
    summary:
      'The same server in a native window, local-only on 127.0.0.1: it runs your tests, reproduces a failure and bisects it in throwaway worktrees, imports local reports, and writes MCP client configs in one click.',
    get: 'Installers on the GitHub releases page for Windows x64, Apple-silicon macOS and Linux x86-64, not yet code-signed.',
    when: 'One developer running Playwright on their own machine, with no server to operate.',
    needs: ['desktop'],
    doc: 'features/desktop',
  },
  {
    id: 'demo',
    name: 'Live demo',
    summary: 'The real dashboard on seeded data, running entirely in your browser — no backend, nothing kept.',
    get: 'https://piwitests.dev/demo/',
    when: 'Looking around before installing anything.',
    needs: [],
    doc: 'guide/getting-started#pick-a-path',
  },
  {
    id: 'reporter',
    name: 'Reporter',
    summary:
      '`@piwitests/reporter`, a Playwright reporter that streams each run to the dashboard while it executes — results, errors, traces, screenshots and the HTML report. A project is created on its first run.',
    get: '`npx @piwitests/reporter init --server-url <url> --project <name>`, or `npm install --save-dev @piwitests/reporter` and a line in `playwright.config`.',
    when: 'Always, for live results. Runs recorded before Piwi can be imported instead.',
    needs: [],
    doc: 'guide/reporter',
  },
  {
    id: 'cli',
    name: '`piwi` CLI',
    summary:
      'The command-line tool that ships with the reporter: `init` wires a project up, `skills` installs the agent skills, `gate` fails a CI job on the dashboard’s analysis, `select` and `run` resolve and run a saved test selection, `ai` manages AI-step artifacts.',
    get: '`npx @piwitests/reporter <command>` — a plain `npx piwi` resolves an unrelated package until the reporter is installed.',
    when: 'Setting a project up, gating merges in CI, and running only the tests that matter.',
    needs: [],
    doc: 'reference/cli',
  },
  {
    id: 'fixtures',
    name: 'Capture fixtures',
    summary:
      'An extended Playwright `test` (`piwiFixtures`) that records network timing, Web Vitals, console output, failure-time ARIA snapshots and the locator snapshots locator healing ranks.',
    get: 'A `tests/fixtures.ts` exporting `base.extend(piwiFixtures)` — `init` creates it — with `test` imported from it in your specs.',
    when: 'Recommended: locator healing, slow endpoints, Web Vitals and the richer failure evidence need it.',
    needs: [],
    doc: 'guide/capture-fixtures',
  },
  {
    id: 'ai-steps',
    name: 'AI steps',
    summary:
      '`page.piwiLocator()` and `page.piwiRun()` take plain English. Each prompt is resolved once into a committed artifact, and every later run replays it as ordinary Playwright with no model call.',
    get: 'Part of the reporter; the AI steps page covers setup and the `piwi ai` commands.',
    when: 'Writing steps in plain English without a model in the loop at run time.',
    needs: ['llm'],
    doc: 'guide/ai-steps',
  },
  {
    id: 'backend-logs',
    name: 'Backend-log integrations',
    summary:
      'Packages for the app under test that capture its server-side warnings and errors per test, shown next to the request that triggered them: `@piwitests/instrumentation-nitro` (Nitro / Nuxt) and `PiwiTests.Instrumentation.AspNetCore` (ASP.NET Core).',
    get: '`npm install @piwitests/instrumentation-nitro`, or `dotnet add package PiwiTests.Instrumentation.AspNetCore`.',
    when: 'Your app under test runs on Nitro, Nuxt or ASP.NET Core, and a UI failure may start as a server error.',
    needs: ['fixtures', 'backend'],
    doc: 'guide/backend-logs',
  },
  {
    id: 'extension',
    name: 'Browser extension (Piwi Picker)',
    summary:
      'A Chrome and Edge extension that picks ranked, stable Playwright locators from any page and records actions as test code. It works on its own; connected to an instance, it also matches your test-function catalog.',
    get: 'The Piwi Picker listing on the Chrome Web Store, which covers Edge and other Chromium browsers.',
    when: 'Writing or fixing locators against a live page.',
    needs: ['extension'],
    doc: 'features/extension',
  },
  {
    id: 'mcp',
    name: 'MCP server',
    summary:
      'Built into every dashboard at `/mcp`, with the same API keys as the REST API: tools that give a coding agent your runs, failures, clusters, flaky tests, diagnoses and fix plans, plus the `setup_piwi` prompt.',
    get: 'Point an MCP client at `<dashboard>/mcp`; the dashboard’s MCP server page has per-client snippets, and the desktop app writes client configs in one click.',
    when: 'A coding agent should read your results and hand back fixes.',
    needs: [],
    doc: 'features/mcp',
  },
  {
    id: 'skills',
    name: 'Agent skills',
    summary:
      'Five `SKILL.md` workflows — set Piwi up, investigate a failure, apply locator healing, stabilize flaky tests, run the right tests — that teach a coding agent the Piwi loop; the four investigation skills use the MCP tools when they are connected.',
    get: '`npx @piwitests/reporter skills add`; `init` installs the four workflow skills.',
    when: 'Your coding agent should follow the Piwi workflow end to end.',
    needs: [],
    doc: 'features/mcp#agent-skills',
  },
  {
    id: 'api',
    name: 'REST API',
    summary:
      'Everything the dashboard does, over HTTP with `pd_` API keys. Each instance serves its own OpenAPI reference at `/docs` (the spec is `/_openapi.json`).',
    get: 'Your dashboard’s `/docs` page, or the demo’s reference at https://piwitests.dev/demo/docs.',
    when: 'Scripting against Piwi outside the reporter and the MCP server.',
    needs: [],
    doc: 'operate/authentication#using-the-api-key-in-raw-http-calls',
  },
];

/** One option of a setup decision. */
export interface SetupOption {
  option: string;
  /** When this option is the right one, and what it takes. */
  when: string;
}

/** A decision every team makes once, with the page that settles it. */
export interface SetupDecision {
  id: string;
  question: string;
  /** What happens when you decide nothing. */
  default: string;
  options: SetupOption[];
  doc: string;
}

export const SETUP_DECISIONS: SetupDecision[] = [
  {
    id: 'where',
    question: 'Where should the dashboard run?',
    default: 'Nothing runs until you pick one.',
    options: [
      { option: 'Live demo', when: 'Looking around first — seeded data in your browser, nothing kept.' },
      {
        option: 'Desktop app',
        when: 'One developer on Windows x64, Apple-silicon macOS or Linux x86-64; no Docker or Node needed.',
      },
      { option: 'Docker', when: 'A shared, long-lived instance for a team — the recommended path.' },
      { option: '`npx @piwitests/server`', when: 'A quick local run where Node.js 22+ is installed.' },
      {
        option: 'One-click deploy',
        when: 'A shared instance with no server of your own: Railway, Render, Fly.io, Koyeb, Coolify or Dokploy.',
      },
    ],
    doc: 'guide/getting-started#pick-a-path',
  },
  {
    id: 'database',
    question: 'SQLite or PostgreSQL?',
    default: 'SQLite, created automatically in `.data/piwi.db`.',
    options: [
      { option: 'SQLite', when: 'Zero configuration; one writer at a time is ample for a team’s test volume.' },
      {
        option: 'PostgreSQL 14+',
        when: 'Set `PIWI_DATABASE_URL` when several dashboard replicas share one database, `database is locked` shows up under load, or Postgres is your ops standard.',
      },
    ],
    doc: 'operate/database',
  },
  {
    id: 'storage',
    question: 'Where do traces, reports and screenshots go?',
    default: 'Local disk, under `.data/storage/`.',
    options: [
      { option: 'Local disk', when: 'No configuration; back the directory up with the database.' },
      {
        option: 'S3-compatible storage',
        when: '`PIWI_STORAGE_TYPE=s3` with a bucket and region — AWS S3 (static keys optional, instance roles work), Cloudflare R2, DigitalOcean Spaces, RustFS and others.',
      },
    ],
    doc: 'operate/storage',
  },
  {
    id: 'auth',
    question: 'Turn authentication on?',
    default: 'Off: every request is treated as an administrator.',
    options: [
      { option: 'Off', when: 'Only on localhost or in the desktop app.' },
      {
        option: 'On',
        when: 'Anything reachable from a network: `PIWI_AUTH_ENABLED=true` and `PIWI_AUTH_SECRET`, then administrator, reporter and user roles, per-project access, `pd_` API keys for CI and agents, and optional Google or GitHub sign-in. Browser sign-in then needs HTTPS (or localhost). Set `PIWI_SECRET_KEY` too, and work through the production checklist.',
      },
    ],
    doc: 'operate/production-checklist',
  },
  {
    id: 'fixtures',
    question: 'Add the capture fixtures?',
    default: 'Off: `init` creates the fixtures file, and each spec opts in by importing `test` from it.',
    options: [
      {
        option: 'Yes (recommended)',
        when: 'Import `test` from the fixtures file in your specs, and locator healing, slow endpoints, Web Vitals, console and failure-time ARIA snapshots light up.',
      },
      {
        option: 'Not yet',
        when: 'Results, traces, screenshots, failure clusters and flaky scores work without them, and an uploaded trace still yields console, network and the failure-time ARIA snapshot.',
      },
    ],
    doc: 'guide/capture-fixtures',
  },
  {
    id: 'ai',
    question: 'Use AI diagnosis, and which model?',
    default: 'Off. Clustering, flaky scoring, failure clues, locator healing and fix verification need no model.',
    options: [
      { option: 'No AI', when: 'Everything deterministic still works; AI only adds explanations and patches.' },
      { option: 'Anthropic', when: 'The recommended provider: `PIWI_AI_PROVIDER=anthropic` and an API key.' },
      { option: 'OpenAI', when: '`PIWI_AI_PROVIDER=openai` and an API key.' },
      {
        option: 'OpenAI-compatible or local',
        when: 'Ollama, LM Studio, vLLM and the like: `PIWI_AI_PROVIDER=openai` with `PIWI_AI_BASE_URL`, so nothing leaves your network.',
      },
      {
        option: 'Claude Code (local)',
        when: 'The desktop app, or a server with `PIWI_CLAUDE_CLI_PATH` set, runs the local `claude` CLI on its own sign-in — no API key.',
      },
    ],
    doc: 'features/ai-diagnosis#enabling-ai-diagnosis',
  },
  {
    id: 'scm',
    question: 'Connect source control?',
    default:
      'No token: runs still carry the branch and commit the reporter detects, and public repositories are read anonymously (rate-limited).',
    options: [
      { option: 'No token', when: 'History, clusters, flaky scores and locator healing are unaffected.' },
      {
        option: 'A GitHub, GitLab or Bitbucket token',
        when: 'Private repositories need one for CODEOWNERS ownership and the diff in AI diagnosis. With write access and `PIWI_SITE_URL`: pull-request comments and commit statuses (GitHub, GitLab) and auto-heal pull requests (GitHub, GitLab, Bitbucket Cloud).',
      },
    ],
    doc: 'guide/ci#pull-request-feedback',
  },
  {
    id: 'gate',
    question: 'What should block a merge?',
    default: 'Playwright’s own exit code: any failed test.',
    options: [
      { option: 'The exit code', when: 'You only need "did anything fail".' },
      {
        option: '`piwi gate`',
        when: 'The dashboard’s analysis decides: new regressions, newly flaky tests, a failure cluster never seen before, required tags or a selection that must pass.',
      },
    ],
    doc: 'guide/ci#blocking-a-merge',
  },
  {
    id: 'mcp-modules',
    question: 'Which MCP tools should agents see?',
    default: 'Every tool whose capability is not declined.',
    options: [
      { option: 'All', when: 'The agent can reach every part of Piwi.' },
      { option: '`?modules=core`', when: 'Append to the MCP URL to narrow the list for a tighter token budget.' },
      {
        option: 'Decline a capability',
        when: 'Declining one in Setup, or a whole module in the presets, drops the tools that depend on it for every client; tools that need no capability stay.',
      },
    ],
    doc: 'features/mcp#tool-modules',
  },
  {
    id: 'retention',
    question: 'How much history to keep?',
    default: 'All of it: pruning is opt-in.',
    options: [
      { option: 'Everything', when: 'The history is the point; budget disk for traces and reports.' },
      { option: '`PIWI_RETENTION_DAYS`', when: 'A nightly sweep deletes older runs with their files.' },
    ],
    doc: 'operate/storage#data-retention',
  },
  {
    id: 'history',
    question: 'Start from history you already have?',
    default: 'Trends start with the first reported run.',
    options: [
      { option: 'Start fresh', when: 'Nothing to import.' },
      {
        option: 'Import',
        when: 'Backfill from Playwright blob reports or bare trace files; imports are idempotent and send no notifications.',
      },
    ],
    doc: 'guide/importing-runs',
  },
];

/** Where each kind of feedback goes, and what makes it actionable. */
export const FEEDBACK_CHANNELS = {
  bug: {
    url: `${REPOSITORY}/issues/new?template=bug_report.yml`,
    include: [
      'What you did, what you expected, and what happened instead.',
      'The dashboard version (Settings → About, or `GET /api/version`) and the reporter version.',
      'The deployment: Docker or source, SQLite or PostgreSQL, local or S3 storage, auth on or off.',
      'Server logs or browser console output around the failure.',
    ],
  },
  idea: {
    url: `${REPOSITORY}/issues/new?template=feature_request.yml`,
    include: [
      'The problem first — the situation where the feature is missing matters more than the solution.',
      'A rough sketch of the behavior you would like, and the alternatives you considered.',
      'The roadmap and existing issues, checked first: the idea may already be tracked.',
    ],
  },
  question: PROJECT_LINKS.discussions,
  security: `${REPOSITORY}/security/advisories/new`,
  docs: 'Every docs page has an "Edit this page on GitHub" link; a fix is a pull request against `apps/docs/`.',
  nonGoals: [
    'Other test frameworks (Cypress, Jest, JUnit…) — Piwi stays Playwright-only.',
    'A hosted SaaS — Piwi is built to be self-hosted.',
  ],
} as const;

/**
 * The docs sections the tool quotes verbatim (as plain-text list items) rather
 * than restating: the three jobs, the two rules and the stated limits.
 */
export const QUOTED_DOCS_SECTIONS = {
  jobs: 'guide/what-piwi-does#the-three-jobs',
  rules: 'guide/what-piwi-does#two-rules',
  limits: 'guide/what-piwi-does#what-it-isn-t',
} as const;

/** The topics the MCP `describe_piwi` tool answers, with what each returns. */
export const DESCRIBE_PIWI_TOPICS = {
  overview: 'What Piwi is and is not, its pieces, and this instance.',
  ecosystem: 'Every piece — what it is, how to get it, when you need it.',
  choices: 'The setup decisions, their options and defaults (and, for administrators, what this instance chose).',
  features: 'The feature map: what each feature needs and where it lives (and capability states, for administrators).',
  configuration: 'Every PIWI_* environment variable; add `query` to filter.',
  mcp: 'This MCP server: tool modules, what is served here, desktop-only tools, prompts and skills.',
  feedback: 'Where bug reports, ideas and questions go, what to include, and the non-goals.',
  docs: 'The index of documentation pages, to read with `page`.',
} as const;

export type DescribePiwiTopic = keyof typeof DESCRIBE_PIWI_TOPICS;
