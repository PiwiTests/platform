/**
 * The product feature catalog — one entry per user-facing feature, grouped by
 * the three jobs Piwi serves (keep the history, explain the failures, hand back
 * a fix) plus how you reach it from elsewhere and the operator surface.
 *
 * This is the source for the generated feature map
 * (`apps/docs/reference/feature-map.md`, built at `docs:gen`), the single place
 * a reader can see everything the product does, what each thing needs, where it
 * lives in the dashboard, and which doc explains it.
 *
 * Kept dependency-free in `shared/` so the docs generator can import it with no
 * app/runtime deps, exactly like `piwi-env-vars.ts`. `docs-drift.test.ts`
 * resolves every `doc` target here against a real page + heading, so a renamed
 * page or moved anchor fails the test.
 */

/**
 * What a feature needs beyond a running reporter. The reporter is the baseline
 * every feature builds on, so an empty list renders as "reporter" — anything
 * listed is the extra a reader must switch on.
 */
export type FeatureNeed =
  | 'fixtures' // the capture fixtures
  | 'llm' // a configured AI provider key
  | 'scm' // a source-control access token
  | 'backend' // a backend instrumentation package in the app under test
  | 'desktop' // the desktop app
  | 'extension' // the browser extension
  | 'admin'; // an administrator (or auth disabled)

/** Human labels for the need chips, used by the feature-map generator. */
export const FEATURE_NEED_LABELS: Record<FeatureNeed, string> = {
  fixtures: 'capture fixtures',
  llm: 'an AI key',
  scm: 'an SCM token',
  backend: 'a backend integration',
  desktop: 'the desktop app',
  extension: 'the browser extension',
  admin: 'admin',
};

export interface PiwiFeature {
  /** The feature, in the words a reader would type. */
  title: string;
  /** One line: what it does. */
  summary: string;
  /** Extra prerequisites beyond the reporter; empty means reporter only. */
  needs: FeatureNeed[];
  /** Where it lives in the dashboard — a short route/tab hint. */
  where: string;
  /** Docs page (+ optional `#anchor`), resolved by `docs-drift.test.ts`. */
  doc: string;
}

export interface FeatureGroup {
  /** The job this group of features serves. */
  title: string;
  /** One line describing the job. */
  intro: string;
  features: PiwiFeature[];
}

export const PIWI_FEATURE_GROUPS: FeatureGroup[] = [
  {
    title: 'Keep the history',
    intro:
      'CI deletes every report it makes. Piwi keeps every run, trace and report, so "has this always been flaky?" and "did my fix hold?" are answerable at all.',
    features: [
      {
        title: 'Run history & dashboard map',
        summary: 'Every run, trace and HTML report kept and browsable, live-updating as runs start and finish.',
        needs: [],
        where: 'Home; Project → Runs',
        doc: 'features/ui-overview',
      },
      {
        title: 'Branches & per-branch baselines',
        summary: 'Branch as a first-class dimension: filter by it, and compare against a baseline computed per branch.',
        needs: [],
        where: 'Project → filter bar',
        doc: 'features/branches',
      },
      {
        title: 'What changed in a run',
        summary: 'Compare two runs — newly failing, newly passing, still red — against a chosen baseline.',
        needs: [],
        where: 'Test run → Changes',
        doc: 'features/run-changes',
      },
      {
        title: 'Import past runs',
        summary: 'Backfill history from existing Playwright JSON/blob reports so trends start with a past, not empty.',
        needs: ['admin'],
        where: 'Setup; ingest API',
        doc: 'guide/importing-runs',
      },
      {
        title: 'Analytics & insights',
        summary:
          'Cross-project trends — portfolio health, wasted CI time, pass-rate heatmap, browser matrix, insights feed.',
        needs: [],
        where: 'Analytics',
        doc: 'features/analytics',
      },
      {
        title: 'Timeline markers',
        summary: 'Your deploys and infra changes overlaid on the trend charts, so a step change has a cause.',
        needs: ['admin'],
        where: 'Project → Timeline',
        doc: 'features/timeline-markers',
      },
      {
        title: 'Notifications & alerts',
        summary: 'Email, Slack, webhook and browser channels with per-project subscriptions, digests and mute.',
        needs: [],
        where: 'Settings → Notifications',
        doc: 'features/notifications',
      },
      {
        title: 'Offline export',
        summary:
          'A run or execution exported as a self-contained bundle (and a Perfetto trace) that outlives retention.',
        needs: [],
        where: 'Run / execution → Export',
        doc: 'features/offline-export',
      },
      {
        title: 'Share links',
        summary: 'A signed, read-only link to one failure for someone without an account.',
        needs: [],
        where: 'Execution → Share',
        doc: 'features/share-links',
      },
    ],
  },
  {
    title: 'Explain the failures',
    intro:
      'Group forty red tests into the three problems behind them, score the flaky ones by the CI minutes they waste, and — optionally — have an LLM explain a cluster against your real git diff.',
    features: [
      {
        title: 'Failure evidence',
        summary:
          'One failing execution, diagnosis-first: error, clues, attempts, trace-powered views and (with fixtures) console, network and ARIA.',
        needs: [],
        where: 'Test case → execution',
        doc: 'features/evidence',
      },
      {
        title: 'Failure clusters & the inbox',
        summary:
          'Failures sharing an error fingerprint collapsed into one cluster, triaged once with an owner and known-issue link.',
        needs: [],
        where: 'Test run → Failures; Home',
        doc: 'features/failure-clusters',
      },
      {
        title: 'Flaky tests & quarantine',
        summary:
          'Flaky detection and cost scoring, with quarantine that keeps a known-bad test running but off the merge gate.',
        needs: [],
        where: 'Project → Flaky',
        doc: 'features/flaky-tests',
      },
      {
        title: 'Slow tests & wasted time',
        summary:
          'Slowest tests, timeout headroom, stale `test.slow()`, slow endpoints and Web Vitals — the time your suite costs.',
        needs: ['fixtures'],
        where: 'Project → Performance; Analytics',
        doc: 'features/slow-tests',
      },
      {
        title: 'AI diagnosis',
        summary:
          'An LLM explains a cluster against your actual diff, with a suggested patch validated against your source first.',
        needs: ['llm'],
        where: 'Cluster → Diagnosis',
        doc: 'features/ai-diagnosis',
      },
      {
        title: 'Backend logs',
        summary:
          'Server-side warnings, errors and spans captured per test and shown next to the request that triggered them.',
        needs: ['backend'],
        where: 'Execution → network',
        doc: 'guide/backend-logs',
      },
    ],
  },
  {
    title: 'Hand back a fix',
    intro:
      'The point is to leave with something to do, not just something to read: a ranked replacement locator, a validated patch, an owner, and the command that verifies the work.',
    features: [
      {
        title: 'Locator healing',
        summary:
          'When a selector breaks, ranked replacement locators captured from the last passing run, with a recommended fix.',
        needs: ['fixtures'],
        where: 'Execution → Locator fix',
        doc: 'features/locator-healing',
      },
      {
        title: 'Fix plans, reproduce & bisect',
        summary: 'A plan to reproduce a failure locally and bisect to the commit that introduced it.',
        needs: ['desktop'],
        where: 'Cluster / execution → Fix plan',
        doc: 'features/fix-plans',
      },
      {
        title: 'Auto-heal PRs',
        summary:
          'A pull request opened for you with a validated locator or patch — you review and merge, Piwi never does.',
        needs: ['scm', 'llm'],
        where: 'Settings → AI diagnosis',
        doc: 'features/auto-heal',
      },
      {
        title: 'Pull-request feedback & re-run',
        summary: 'A summary of the failures on the branch posted to the PR, and a re-run triggered from the dashboard.',
        needs: ['scm'],
        where: 'Settings → Pull requests',
        doc: 'guide/ci',
      },
      {
        title: 'CI merge gate',
        summary:
          'A `piwi gate` command that blocks a merge on new failures or flakiness, with the run URL in the CI log.',
        needs: [],
        where: 'CI (`piwi gate`)',
        doc: 'reference/cli',
      },
      {
        title: 'Test selections & impact',
        summary:
          'Run only the tests that matter — changed files, a subset, balanced shards — from the CLI or the dashboard.',
        needs: [],
        where: 'Project → Selections; CLI',
        doc: 'guide/test-selection',
      },
      {
        title: 'AI steps',
        summary: 'Author and replay natural-language test steps an LLM turns into Playwright actions.',
        needs: ['llm'],
        where: 'Reporter config',
        doc: 'guide/ai-steps',
      },
    ],
  },
  {
    title: 'Use it from elsewhere',
    intro: 'Reach your results and act on them from wherever you already work.',
    features: [
      {
        title: 'MCP server',
        summary:
          'A Model Context Protocol server that gives coding agents read access to your runs, failures and diagnoses.',
        needs: [],
        where: 'MCP server (`/mcp`)',
        doc: 'features/mcp',
      },
      {
        title: 'Agent skills',
        summary: 'Installable skills that teach a coding agent the Piwi failure-fixing workflow end to end.',
        needs: [],
        where: 'reporter CLI (`piwi skills`)',
        doc: 'features/mcp#agent-skills',
      },
      {
        title: 'Desktop app',
        summary: 'A local instance in a desktop shell — run tests, reproduce and bisect, with one-click MCP wiring.',
        needs: ['desktop'],
        where: 'Desktop app',
        doc: 'features/desktop',
      },
      {
        title: 'Browser extension',
        summary: 'Record actions, build and lint locators, and copy context for an agent, straight from the page.',
        needs: ['extension'],
        where: 'Browser extension',
        doc: 'features/extension',
      },
      {
        title: 'Test functions catalog',
        summary: 'The reusable helpers and page-object methods your suite calls, catalogued with their parameters.',
        needs: [],
        where: 'Project → Test functions',
        doc: 'features/test-functions',
      },
      {
        title: 'Open in IDE',
        summary: 'Every source path in the dashboard jumps to that file and line in VS Code or JetBrains.',
        needs: [],
        where: 'any source path',
        doc: 'features/ide-integration',
      },
    ],
  },
  {
    title: 'Run your instance',
    intro: 'Operate a shared, self-hosted instance for a team.',
    features: [
      {
        title: 'Authentication & roles',
        summary: 'Optional sign-in with roles (admin, reporter, viewer), API keys for CI, and Google/GitHub OAuth.',
        needs: ['admin'],
        where: 'Settings → Users',
        doc: 'operate/authentication',
      },
      {
        title: 'Project access',
        summary: 'Scope who can see and act on each project, for multi-team instances.',
        needs: ['admin'],
        where: 'Settings → Users',
        doc: 'operate/authentication#project-access',
      },
      {
        title: 'Data retention & cleanup',
        summary: 'Cap how much run history you keep, with a nightly sweep and manual bulk cleanup.',
        needs: ['admin'],
        where: 'Settings → Storage',
        doc: 'operate/storage#data-retention',
      },
      {
        title: 'Backup & restore',
        summary: 'What to copy for a safe backup of the database and file storage, and how to restore it.',
        needs: ['admin'],
        where: 'operator (filesystem)',
        doc: 'operate/backup-restore',
      },
    ],
  },
];
