/**
 * Single source of truth for every inline-help hint shown by `HelpHint`.
 *
 * Keying by a stable dotted topic id keeps copy consistent and auditable, makes
 * future i18n trivial, and turns a missing/typo'd key into a compile-time error
 * at the call site (the `help` prop is typed as `HelpTopicKey`).
 *
 * Copy rules: 1–2 sentences, sentence case, American English. The `doc` field
 * is a docs page + optional `#anchor` passed through `docsUrl()`; omit it when
 * no docs section exists yet (text-only hint). The `envVars` field lists the
 * `PIWI_*` environment variable(s) that override the setting; it is typed as
 * `PiwiEnvVarName[]` so a typo is a compile error (see `shared/piwi-env-vars`).
 */
import type { PiwiEnvVarName } from '~~/shared/piwi-env-vars';

export interface HelpTopic {
  /** Optional bold heading shown at the top of the popover. */
  title?: string;
  /** 1–2 sentence explanation. */
  text: string;
  /** Docs page + optional `#anchor` (passed to `docsUrl()`); omit if none. */
  doc?: string;
  /**
   * `PIWI_*` environment variable(s) that override this setting (env always
   * wins; the UI shows the field read-only when set). Listed in the popover so a
   * system admin knows which env var backs this setting. Omit for settings that
   * are not env-overridable (DB-only, informational, etc.).
   */
  envVars?: PiwiEnvVarName[];
}

export const HELP_TOPICS = {
  // ── Home ──────────────────────────────────────────────────────────────
  'home.flaky': {
    title: 'Flaky tests',
    text: 'Tests that pass and fail without code changes. This counts how many were detected across your projects recently.',
    doc: 'flaky-tests#flaky-test-detection',
  },
  'home.trend-bars': {
    title: 'Run history bars',
    text: 'One bar per full run (up to 20), oldest left → newest right. Green = pass, red = fail, amber = passed with flaky tests, gray = skipped/unknown. Click a bar to open that run.',
    doc: 'ui-overview#home-page',
  },
  'home.tendency': {
    title: 'Tendency',
    text: 'Derived from the last 5 full runs. Failing = latest run failed; flaky = pass/fail mixed or flaky tests seen in the window; passing = all recent runs green.',
    doc: 'ui-overview#home-page',
  },
  'home.project-health': {
    title: 'Project health',
    text: 'Every project at a glance — run history bars and a tendency badge so you can immediately see which project needs attention. Only full runs count.',
    doc: 'ui-overview#home-page',
  },
  'home.get-started': {
    title: 'Get started',
    text: 'Wire the Piwi reporter into your Playwright config to start sending results here. The wizard generates the snippet for you.',
    doc: 'getting-started#using-the-piwi-dashboard-reporter',
  },

  // ── Projects list ─────────────────────────────────────────────────────
  'projects.tag-filter': {
    text: 'Filter projects by tag. Selecting several tags uses OR logic — a project matching any of them is shown.',
  },
  'projects.table': {
    title: 'Projects',
    text: 'Every project that has reported results, with its latest run, pass rate and activity. Click a row to drill in.',
    doc: 'ui-overview#projects-page',
  },

  // ── Project detail ────────────────────────────────────────────────────
  'project.run-scope': {
    title: 'Full vs partial runs',
    text: 'A partial run executed only a subset of the suite (a shard, a retry, or a filtered selection). Trends use full runs so partial results don’t skew the numbers.',
    doc: 'ui-overview#test-run-detail',
  },
  'project.runs-trend': {
    title: 'Run trend',
    text: 'Pass/fail counts per run over time. Hover a point for the exact run; sudden drops mark where things broke.',
    doc: 'ui-overview#project-detail',
  },
  'project.flaky-tests': {
    title: 'Flaky tests',
    text: 'Tests that fail intermittently across runs. Impact estimates wasted CI time; the score (0–100) rates severity and root cause explains why.',
    doc: 'flaky-tests#flaky-test-detection',
  },
  'project.performance': {
    title: 'Performance',
    text: 'Duration trends for the suite — average and P90 (the slowest 10% threshold). Use it to catch tests getting steadily slower.',
    doc: 'flaky-tests#performance',
  },
  'project.slowest-tests': {
    title: 'Slowest tests',
    text: 'The tests taking the most time, ranked. Optimizing the top entries shortens your overall run the fastest.',
    doc: 'ui-overview#performance-page',
  },
  'project.run-compare': {
    title: 'Run comparison',
    text: 'Diff two runs to see which tests changed status or duration between them — handy for confirming a fix or spotting a regression.',
    doc: 'ui-overview#test-run-detail',
  },
  'project.test-cases': {
    title: 'Test cases',
    text: 'Every distinct test in the project with its pass rate across runs. Click one to see its full history.',
    doc: 'ui-overview#project-detail',
  },
  'project.compare': {
    title: 'Compare runs',
    text: 'Pick two runs to see a side-by-side summary and a per-test status diff between them.',
    doc: 'ui-overview#test-run-detail',
  },
  'project.spec-health': {
    title: 'Spec health',
    text: 'A heatmap grouped by spec file: pass rate, flaky rate and average time per spec, so you can find the riskiest files at a glance.',
    doc: 'flaky-tests#spec-health-heatmap',
  },
  'project.members': {
    title: 'Project access',
    text: 'Who can see this project. Admins always have access; reporters and users see only the projects assigned to them.',
    doc: 'authentication#user-management',
  },
  'project.ai-instructions': {
    title: 'AI diagnosis instructions',
    text: 'Extra guidance handed to the AI when diagnosing this project’s failures — e.g. domain terms, known-flaky areas, or where to look first.',
    doc: 'ai-diagnosis#custom-instructions',
  },
  'project.scm-token': {
    title: 'Repository access token',
    text: 'A read-only Git host token lets diagnosis pull the actual commit diffs behind a failure for SCM-grounded analysis. Stored encrypted.',
    doc: 'ai-diagnosis#scm-grounded-context',
  },

  // ── Test run detail ───────────────────────────────────────────────────
  'run.summary': {
    title: 'Run summary',
    text: 'Headline outcome of this run — overall status, test counts and total duration.',
    doc: 'ui-overview#test-run-detail',
  },
  'run.partial': {
    title: 'Partial run',
    text: 'This run covered only part of the suite (a shard, retry or filtered selection), so its totals aren’t a full picture.',
    doc: 'ui-overview#test-run-detail',
  },
  'run.live': {
    title: 'Live run',
    text: 'This run is still streaming results in real time. Results and counts update as each test finishes.',
    doc: 'reporter#live-streaming',
  },
  'run.ci-env': {
    title: 'CI & environment',
    text: 'Where this run executed — CI provider, pipeline and machine details — collected automatically by the reporter.',
    doc: 'reporter#automatic-metadata-collection',
  },
  'run.reports': {
    title: 'Storage & reports',
    text: 'HTML reports, traces and attachments uploaded with this run. A run can carry several reports (e.g. per shard).',
    doc: 'reporter#multiple-reports',
  },
  'run.metadata': {
    title: 'Tags, links & custom data',
    text: 'Extra context attached to the run: tags for grouping, links to external issues, and any custom key/value data your reporter sent.',
  },
  'run.test-cases': {
    title: 'Test cases',
    text: 'Per-test results for this run. Filter by status, or by the NEW (new regression) and FLAKY signal badges.',
    doc: 'ui-overview#test-run-detail',
  },
  'run.insights': {
    title: 'Run insights',
    text: 'Automatic highlights for this run — newly failing, flaky and slow tests — surfaced so you don’t have to hunt for them.',
    doc: 'flaky-tests#run-insights',
  },
  'run.regression': {
    title: 'Regression signals',
    text: 'Tests that newly started failing in this run versus the project baseline — the most likely fallout from the latest change.',
    doc: 'flaky-tests#regression-signals',
  },
  'run.timeline': {
    title: 'Workers timeline',
    text: 'When each test ran on each parallel worker. Gaps and long bars reveal poor parallelization or a single slow test stalling a shard.',
    doc: 'ui-overview#test-run-detail',
  },
  // ── Single execution (test-run-case) ──────────────────────────────────
  'case.web-vitals': {
    title: 'Web Vitals',
    text: 'Core Web Vitals (LCP, CLS, etc.) captured during the test, measuring real loading and responsiveness of the page under test.',
    doc: 'reporter#performance-metrics-web-vitals',
  },
  'case.traces': {
    title: 'Traces',
    text: 'Playwright trace files for this execution. Open one in the trace viewer to step through actions, snapshots and network.',
    doc: 'ui-overview#test-case-detail',
  },
  'case.console': {
    title: 'Console output',
    text: 'Browser console messages logged while this test ran — often the first clue for a JavaScript error behind a failure.',
    doc: 'reporter#performance-metrics-web-vitals',
  },
  'case.network': {
    title: 'Network requests',
    text: 'HTTP requests the page made during the test, with timing and status — useful for spotting failed or slow calls.',
    doc: 'reporter#performance-metrics-web-vitals',
  },
  'case.backend-logs': {
    title: 'Backend server logs',
    text: 'Server-side warnings and errors captured during the test, correlated with this execution via a Piwi backend integration.',
    doc: 'backend-logs',
  },
  'case.aria': {
    title: 'ARIA snapshot',
    text: 'A snapshot of the accessibility tree at the moment of failure — what assistive tech saw, and useful grounding for AI diagnosis.',
    doc: 'ai-diagnosis#what-a-diagnosis-contains',
  },

  // ── Test case across runs ─────────────────────────────────────────────
  'case.flaky-count': {
    title: 'Flaky runs',
    text: 'How many of this test’s recent executions flipped between pass and fail without a code change.',
    doc: 'flaky-tests#flaky-test-detection',
  },
  'case.history-chart': {
    title: 'Duration trend',
    text: 'This test’s duration across recent runs. Rising times or spikes hint at a slowdown or instability.',
    doc: 'flaky-tests#flaky-test-detection',
  },
  'case.sparkline': {
    title: 'Status history',
    text: 'Pass/fail outcome of this test over its recent runs, oldest to newest — a quick read on its stability.',
    doc: 'flaky-tests#flaky-test-detection',
  },

  // ── Failure clusters ──────────────────────────────────────────────────
  'cluster.concept': {
    title: 'Failure clusters',
    text: 'Failures with the same error fingerprint are grouped into one cluster, so a single root cause shows up once instead of N times.',
    doc: 'ai-diagnosis#failure-clustering',
  },
  'cluster.new-vs-known': {
    title: 'New vs known failure',
    text: 'Whether this failure matches an existing cluster (a known issue) or opened a new one — a fresh signature worth a closer look.',
    doc: 'ai-diagnosis#failure-clustering',
  },
  'cluster.triage': {
    text: 'Track a cluster’s state: set its status, add triage notes, or extract a subset of failures into a separate cluster.',
  },
  'cluster.evidence': {
    title: 'Test evidence',
    text: 'The concrete artifacts behind this cluster — screenshots, signals and traces from affected tests — gathered for review and AI diagnosis.',
    doc: 'ai-diagnosis#what-a-diagnosis-contains',
  },
  'cluster.scm': {
    title: 'What changed',
    text: 'Recent commits and diffs around when this failure started, so you can connect the break to the change that caused it.',
    doc: 'ai-diagnosis#scm-grounded-context',
  },
  'cluster.baseline': {
    title: 'Baseline commit',
    text: 'The last known-good commit. Diffs are computed from here forward to scope the search for the offending change.',
    doc: 'ai-diagnosis#scm-grounded-context',
  },
  'cluster.commit-browser': {
    title: 'Commit browser',
    text: 'Browse the repository’s recent commits and inspect each diff to pick a baseline or find the suspect change.',
    doc: 'ai-diagnosis#scm-grounded-context',
  },
  'cluster.diagnosis': {
    title: 'AI diagnosis',
    text: 'Runs the configured AI model over the failure plus its evidence and code changes to propose a root cause and fix.',
    doc: 'ai-diagnosis#enabling-ai-diagnosis',
  },
  'cluster.context-input': {
    title: 'Additional context',
    text: 'Extra notes, files or screenshots you add to steer the diagnosis — anything the model can’t infer from the captured evidence.',
    doc: 'ai-diagnosis#custom-instructions',
  },
  'cluster.context-preview': {
    title: 'Context preview',
    text: 'Exactly what will be sent to the AI, including how much was trimmed to fit the token budget. Review it before spending tokens.',
    doc: 'ai-diagnosis#context-limits-and-token-cost',
  },
  'cluster.result': {
    title: 'Diagnosis result',
    text: 'The AI’s proposed root cause, fix and confidence. Treat it as a lead to verify, not proof — confirm against the evidence before acting.',
    doc: 'ai-diagnosis#what-a-diagnosis-contains',
  },
  'cluster.ai-setup': {
    title: 'AI not configured',
    text: 'Diagnosis needs an AI provider and API key. Configure one in Settings → AI to enable automatic and on-demand analysis.',
    doc: 'ai-diagnosis#enabling-ai-diagnosis',
  },
  'cluster.confidence': {
    title: 'Confidence score',
    text: 'How sure the model is of the top hypothesis (0–100). It is lowered when key evidence is missing or truncated, so treat a low score as “gather more before acting”.',
    doc: 'ai-diagnosis#what-a-diagnosis-contains',
  },
  'cluster.hypotheses': {
    title: 'Other hypotheses',
    text: 'Alternative root causes the model weighed, ranked by likelihood. Useful when the evidence is ambiguous and the top pick is not conclusive.',
    doc: 'ai-diagnosis#what-a-diagnosis-contains',
  },
  'cluster.coverage': {
    title: 'Data coverage',
    text: 'Which evidence sections were present, truncated or absent for this diagnosis — the same map the model sees. Absent or trimmed evidence lowers confidence; the quote icon marks sections the diagnosis cited.',
    doc: 'ai-diagnosis#context-limits-and-token-cost',
  },
  'cluster.recent-runs': {
    title: 'Recent runs',
    text: 'The most recent test runs where this cluster appeared. Use the Extract button to unlink test cases that were incorrectly grouped.',
  },

  // ── Notifications / subscribe ─────────────────────────────────────────
  'notifications.subscribe': {
    title: 'Project notifications',
    text: 'Get notified about this project’s runs through your channels. Choose which events trigger an alert.',
    doc: 'notifications#subscriptions',
  },

  // ── Settings ──────────────────────────────────────────────────────────
  'settings.general': {
    title: 'General settings',
    text: 'Central place for account, users, AI diagnosis, notifications, storage and tags. Settings that can be overridden by environment variables show a lock badge naming the variable.',
  },
  'settings.storage-stats': {
    title: 'Storage statistics',
    text: 'How much disk your reports, traces and attachments use, broken down so you can see what to clean up.',
    doc: 'storage#storage-architecture',
  },
  'settings.cleanup': {
    title: 'Cleanup old runs',
    text: 'Delete runs (and their reports, traces and attachments) older than a chosen age to reclaim storage. This cannot be undone.',
    doc: 'storage#storage-management',
  },
  'account.email': {
    title: 'Email & verification',
    text: 'Your account email is used for password resets and notifications. Verifying it confirms you own the address.',
    doc: 'authentication#user-management',
  },
  'settings.smtp': {
    title: 'SMTP status',
    text: 'Outbound email (resets, invites, notifications) is configured through environment variables and shown here read-only.',
    doc: 'notifications#smtp-configuration',
    envVars: [
      'PIWI_SMTP_HOST',
      'PIWI_SMTP_PORT',
      'PIWI_SMTP_USER',
      'PIWI_SMTP_PASS',
      'PIWI_SMTP_FROM',
      'PIWI_SMTP_FROM_NAME',
      'PIWI_SMTP_SECURE',
    ],
  },
  'notifications.channels': {
    title: 'Channels',
    text: 'Destinations an alert can go to — email, Slack or webhook. Create a channel, then subscribe events to it.',
    doc: 'notifications#channels',
  },
  'notifications.subscriptions': {
    title: 'Subscriptions',
    text: 'Which events (run failed, new cluster, etc.) notify which channel, optionally scoped to one project and filtered.',
    doc: 'notifications#subscriptions',
  },
  'settings.ai-provider': {
    title: 'AI provider',
    text: 'Choose the model provider and key used for failure diagnosis. The key is stored encrypted and never returned by the API.',
    doc: 'ai-diagnosis#enabling-ai-diagnosis',
    envVars: ['PIWI_AI_PROVIDER', 'PIWI_AI_MODEL', 'PIWI_AI_API_KEY', 'PIWI_AI_BASE_URL'],
  },
  'settings.ai-instructions': {
    title: 'Global analysis instructions',
    text: 'Guidance applied to every diagnosis across all projects — house style, terminology, or things to always check. Per-project instructions add to this.',
    doc: 'ai-diagnosis#custom-instructions',
  },
  'settings.ai-research': {
    title: 'Research model',
    text: 'An optional cheaper/faster model that pre-analyzes the failure (on a lean view) before the main model writes the final diagnosis. It can use its own provider, and the costly SCM diff is only fetched when it flags a likely regression.',
    doc: 'ai-diagnosis#enabling-ai-diagnosis',
    envVars: [
      'PIWI_AI_RESEARCH_PROVIDER',
      'PIWI_AI_RESEARCH_MODEL',
      'PIWI_AI_RESEARCH_BASE_URL',
      'PIWI_AI_RESEARCH_API_KEY',
    ],
  },
  'settings.ai-limits': {
    title: 'Diagnosis context limits',
    text: 'Caps on how much evidence (and how many tokens) go into each diagnosis. Higher limits give the model more to work with but cost more. Each field can be pinned individually by its env var.',
    doc: 'ai-diagnosis#context-limits-and-token-cost',
    envVars: [
      'PIWI_AI_MAX_SAMPLE_ERROR_CHARS',
      'PIWI_AI_MAX_SCM_PATCH_BUDGET',
      'PIWI_AI_MAX_AFFECTED_TESTS',
      'PIWI_AI_MAX_STEPS',
      'PIWI_AI_MAX_CONSOLE_ENTRIES',
      'PIWI_AI_MAX_CONSOLE_ENTRY_CHARS',
      'PIWI_AI_MAX_NETWORK_REQUESTS',
      'PIWI_AI_MAX_ARIA_SNAPSHOT_CHARS',
      'PIWI_AI_MAX_TEST_SOURCE_CHARS',
      'PIWI_AI_MAX_SERVER_LOG_ENTRIES',
      'PIWI_AI_MAX_SERVER_LOG_ENTRY_CHARS',
      'PIWI_AI_MAX_IMAGES',
      'PIWI_AI_MAX_PASSED_PEERS',
      'PIWI_AI_MAX_CONSOLE_WINDOW',
      'PIWI_AI_SLOW_REQUEST_MS',
    ],
  },
  'settings.users': {
    title: 'Users & roles',
    text: 'Manage accounts and their role. Administrators control everything; reporters submit results; users have read-only access.',
    doc: 'authentication#roles',
  },
  'settings.api-keys': {
    title: 'API keys',
    text: 'Tokens (prefixed pd_) that let the reporter or scripts authenticate without a password. Shown once at creation; revoke anytime.',
    doc: 'authentication#api-keys',
  },
  'settings.tags': {
    text: 'Reusable labels you can attach to projects for grouping and filtering across the dashboard.',
  },
  'settings.wasted-time': {
    title: 'Wasted-time patterns',
    text: 'Define which wait steps count as wasted time. A wait is wasted when any pattern matches its step title or source location. Patterns are case-insensitive and support * and ? wildcards. Changes apply to existing runs immediately.',
    doc: 'flaky-tests#performance',
    envVars: ['PIWI_WASTED_WAIT_PATTERNS'],
  },
  'settings.auto-diagnose': {
    title: 'Auto-diagnose',
    text: 'Automatically diagnose new failure clusters when a run finishes — one LLM call per new cluster, max 3 per run. Requires the diagnosis model to be configured.',
    doc: 'ai-diagnosis#enabling-ai-diagnosis',
    envVars: ['PIWI_AI_AUTO_DIAGNOSE'],
  },
  'settings.embedding-model': {
    title: 'Embedding model',
    text: 'Embeds failures so semantically-similar errors group together (used by failure clustering). Can reuse another role’s provider or configure its own.',
    doc: 'ai-diagnosis#enabling-ai-diagnosis',
    envVars: [
      'PIWI_AI_EMBEDDING_PROVIDER',
      'PIWI_AI_EMBEDDING_MODEL',
      'PIWI_AI_EMBEDDING_BASE_URL',
      'PIWI_AI_EMBEDDING_API_KEY',
    ],
  },
  'settings.privacy': {
    title: 'Privacy notice',
    text: 'What data is sent to the configured LLM provider when diagnosing a failure, and how secrets are stored. API keys are encrypted at rest; env vars keep them out of the DB entirely.',
    doc: 'ai-diagnosis#what-a-diagnosis-contains',
  },
  'settings.storage-backend': {
    title: 'Storage backend',
    text: 'Where test artifacts (HTML reports, traces, attachments) are stored — local disk or S3. Configured entirely through environment variables; shown here read-only.',
    doc: 'storage#storage-architecture',
    envVars: [
      'PIWI_STORAGE_TYPE',
      'PIWI_STORAGE_PATH',
      'PIWI_S3_BUCKET',
      'PIWI_S3_REGION',
      'PIWI_S3_ACCESS_KEY_ID',
      'PIWI_S3_SECRET_ACCESS_KEY',
      'PIWI_S3_ENDPOINT',
      'PIWI_S3_FORCE_PATH_STYLE',
    ],
  },
  'settings.auth-toggle': {
    title: 'Authentication',
    text: 'Role-based access control and API keys. Off by default — when disabled, every endpoint behaves as a single virtual administrator.',
    doc: 'authentication',
    envVars: ['PIWI_AUTH_ENABLED', 'PIWI_AUTH_SECRET'],
  },
  'account.display-name': {
    title: 'Display name',
    text: 'A friendly name shown alongside your account. Optional, and visible only within the dashboard.',
  },
  'account.connected-accounts': {
    title: 'Connected accounts',
    text: 'Sign in with an OAuth provider (Google or GitHub). Providers are configured by an operator through environment variables; one provider can be linked per account.',
    doc: 'authentication#oauth-sign-in',
    envVars: [
      'PIWI_OAUTH_GOOGLE_CLIENT_ID',
      'PIWI_OAUTH_GOOGLE_CLIENT_SECRET',
      'PIWI_OAUTH_GITHUB_CLIENT_ID',
      'PIWI_OAUTH_GITHUB_CLIENT_SECRET',
      'PIWI_OAUTH_ALLOWED_DOMAINS',
      'PIWI_OAUTH_GITHUB_ALLOWED_ORGS',
    ],
  },
  'account.password': {
    title: 'Password',
    text: 'Change the password you sign in with. OAuth-only accounts manage their password through their provider.',
    doc: 'authentication#user-management',
  },
  'notifications.test-email': {
    title: 'Send test email',
    text: 'Send a test message through the configured SMTP server to verify delivery. Uses the environment-configured SMTP connection.',
    doc: 'notifications#smtp-configuration',
  },

  // ── MCP ───────────────────────────────────────────────────────────────
  'mcp.tools': {
    title: 'What it provides',
    text: 'The tools this MCP server exposes to AI agents, letting them query your projects, runs and failures directly.',
    doc: 'mcp#what-it-provides',
  },
  'mcp.auth': {
    title: 'Authentication',
    text: 'How an MCP client authenticates to this server — uses the same API keys as the rest of the dashboard.',
    doc: 'mcp#authentication',
  },
  'mcp.client-setup': {
    title: 'Client setup',
    text: 'Copy-paste configuration to connect Claude Code, Cursor, VS Code and other MCP clients to this server.',
    doc: 'mcp#client-setup',
  },

  // ── Shared ────────────────────────────────────────────────────────────
  'shared.entity-links': {
    title: 'Entity links',
    text: 'Links to external systems (Jira, GitHub, etc.) attached to this item. The provider is detected automatically from the URL.',
  },

  // ── Locator healing ────────────────────────────────────────────────────
  'locator-healing': {
    title: 'Alternative locators',
    text: 'When a locator breaks after a UI change, Piwi suggests pre-captured alternatives from the last passing run. Each alternative is ranked by stability score — prefer data-testid (100) over CSS classes (10–40).',
    doc: 'reporter#locator-healing',
  },
} as const satisfies Record<string, HelpTopic>;

export type HelpTopicKey = keyof typeof HELP_TOPICS;

/**
 * Env var(s) attached to a help topic (typed as `PiwiEnvVarName[]`). Returns an
 * empty array when the topic has none. Use this instead of indexing
 * `HELP_TOPICS[key].envVars` directly — the `as const` registry narrows each
 * entry to its literal shape, so direct indexing errors on entries that omit
 * `envVars`; this helper widens through `HelpTopic`.
 */
export function helpEnvVars(key: HelpTopicKey): PiwiEnvVarName[] {
  return (HELP_TOPICS[key] as HelpTopic).envVars ?? [];
}
