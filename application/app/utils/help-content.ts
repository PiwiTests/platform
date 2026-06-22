/**
 * Single source of truth for every inline-help hint shown by `HelpHint`.
 *
 * Keying by a stable dotted topic id keeps copy consistent and auditable, makes
 * future i18n trivial, and turns a missing/typo'd key into a compile-time error
 * at the call site (the `help` prop is typed as `HelpTopicKey`).
 *
 * Copy rules: 1–2 sentences, sentence case, American English. The `doc` field
 * is a docs page + optional `#anchor` passed through `docsUrl()`; omit it when
 * no docs section exists yet (text-only hint).
 */
export interface HelpTopic {
  /** Optional bold heading shown at the top of the popover. */
  title?: string;
  /** 1–2 sentence explanation. */
  text: string;
  /** Docs page + optional `#anchor` (passed to `docsUrl()`); omit if none. */
  doc?: string;
}

export const HELP_TOPICS = {
  // ── Home ──────────────────────────────────────────────────────────────
  'home.flaky': {
    title: 'Flaky tests',
    text: 'Tests that pass and fail without code changes. This counts how many were detected across your projects recently.',
    doc: 'flaky-tests#flaky-test-detection',
  },
  'home.pass-rate-trend': {
    title: 'Pass-rate trend',
    text: 'Share of tests passing per run over time. A downward slope flags a regression building up across recent runs.',
    doc: 'ui-overview#home-page',
  },
  'home.project-health': {
    title: 'Project health',
    text: 'Each project at a glance — latest pass rate and recent activity — so you can spot the one that needs attention.',
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

  // ── Notifications / subscribe ─────────────────────────────────────────
  'notifications.subscribe': {
    title: 'Subscribe',
    text: 'Get notified about this project’s runs through your channels. Choose which events trigger an alert.',
    doc: 'notifications#subscriptions',
  },

  // ── Settings ──────────────────────────────────────────────────────────
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
  },
  'settings.ai-instructions': {
    title: 'Global analysis instructions',
    text: 'Guidance applied to every diagnosis across all projects — house style, terminology, or things to always check. Per-project instructions add to this.',
    doc: 'ai-diagnosis#custom-instructions',
  },
  'settings.ai-limits': {
    title: 'Diagnosis context limits',
    text: 'Caps on how much evidence (and how many tokens) go into each diagnosis. Higher limits give the model more to work with but cost more.',
    doc: 'ai-diagnosis#context-limits-and-token-cost',
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
} as const satisfies Record<string, HelpTopic>;

export type HelpTopicKey = keyof typeof HELP_TOPICS;
