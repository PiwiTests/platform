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
import type { PiwiEnvVarName } from '#shared/piwi-env-vars';

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
  'home.project-health': {
    title: 'Project health',
    text: 'Every project at a glance — run history bars and a tendency badge so you can immediately see which project needs attention. Only full runs count.',
    doc: 'ui-overview#home',
  },
  'home.get-started': {
    title: 'Get started',
    text: 'Wire the Piwi reporter into your Playwright config to start sending results here. The wizard generates the snippet for you.',
    doc: 'getting-started#using-the-piwi-dashboard-reporter',
  },
  'home.open-failures': {
    title: 'Open failures',
    text: 'Failure clusters still open across your projects, newest first. Open one to investigate, or triage from the keyboard: j / k move, o opens, r resolves, i ignores.',
    doc: 'ui-overview#home',
  },

  // ── Analytics ─────────────────────────────────────────────────────────
  'analytics.insights': {
    title: 'Insights',
    text: 'Auto-generated findings over the selected period — pass-rate drops, failing streaks, stale clusters, wasted CI time. Ranked by severity; click one to jump to the source.',
  },
  'analytics.portfolio': {
    title: 'Portfolio health',
    text: 'Every project over the selected period: pass rate with its change vs the previous period, flaky volume, open failure clusters, and the latest run. Worst health sorts first.',
  },
  'analytics.heatmap': {
    title: 'Pass rate heatmap',
    text: 'Each cell is the aggregate pass rate of one project over one time bucket — green is healthy, red is broken, gray means no runs. Longer periods use wider buckets.',
  },
  'analytics.ci-time': {
    title: 'CI time',
    text: 'Total minutes your test runs consumed, over time, with the change vs the previous equal-length period. Steady growth here is a capacity conversation.',
  },
  'analytics.wasted-time': {
    title: 'Wasted CI time',
    text: 'Minutes that produced no signal: time inside wait steps plus time executing attempts that ended failed or timed out. The strongest argument for fixing slow waits and flaky tests.',
  },
  'analytics.flaky-leaderboard': {
    title: 'Flakiest tests',
    text: 'The worst flaky tests across all projects, using the same scoring as each project’s Flaky tests tab, sorted by wasted-CI impact.',
    doc: 'flaky-tests#flaky-test-detection',
  },
  'analytics.cluster-landscape': {
    title: 'Failure clusters',
    text: 'Open failure clusters across all projects — the biggest and oldest unresolved root causes. Clusters outlive run retention, so this works on long horizons.',
    doc: 'ai-diagnosis#failure-clustering',
  },
  'analytics.regression-velocity': {
    title: 'Regression velocity',
    text: 'How much new breakage each period introduces: tests that passed in a baseline and now fail (regressions), plus tests that turned flaky. Rising bars mean quality debt is accumulating.',
    doc: 'flaky-tests#regression-signals',
  },
  'analytics.browser-matrix': {
    title: 'Browser matrix',
    text: 'Pass rate per project × browser, so a suite that is green on one browser but failing on another (a browser-specific bug) stands out immediately.',
  },
  'analytics.slow-endpoints': {
    title: 'Slow endpoints',
    text: 'Backend calls captured during tests, aggregated across all projects by route: p50/p90 latency, error rate, and how many projects hit each one — a shared endpoint regressing shows up here first.',
    doc: 'capture-fixtures',
  },

  // ── Projects list ─────────────────────────────────────────────────────
  'projects.tag-filter': {
    text: 'Filter projects by tag. Selecting several tags uses OR logic — a project matching any of them is shown.',
  },
  'projects.table': {
    title: 'Projects',
    text: 'Every project that has reported results, with its latest run, pass rate and activity. Click a row to drill in.',
    doc: 'ui-overview#projects',
  },
  'project.import': {
    title: 'Importing past runs',
    text: 'Upload the archives Playwright writes to blob-report/ to backfill runs from before you adopted Piwi. One archive becomes one run, complete with traces and screenshots, and re-uploading the same archive changes nothing. Imports are silent by design — no notifications, AI diagnosis or regression signals, so a backfill never pages the team about months-old failures.',
    doc: 'importing-runs',
    envVars: ['PIWI_IMPORT_MAX_BYTES'],
  },

  // ── Project detail ────────────────────────────────────────────────────
  'project.runs-trend': {
    title: 'Run trend',
    text: 'One stacked bar per run — failed anchored at the bottom, passed on top — following the filters above. A growing red base marks where things broke; hover a bar for the counts, click it to open the run.',
    doc: 'ui-overview#project-detail',
  },
  'project.flaky-tests': {
    title: 'Flaky tests',
    text: 'Tests that fail intermittently across runs. Impact estimates wasted CI time; the score (0–100) rates severity and root cause explains why.',
    doc: 'flaky-tests#flaky-test-detection',
  },
  'project.quarantine': {
    title: 'Quarantine',
    text: 'A quarantined test still runs and still reports — it is only excluded from the CI gate’s verdict. Passing runs accumulate as a streak, so a test that recovers is flagged ready to release instead of staying quarantined forever.',
    doc: 'flaky-tests#quarantine-with-a-way-out',
  },
  'project.performance': {
    title: 'Performance',
    text: 'Duration trends for the suite — average and P90 (the slowest 10% threshold). Use it to catch tests getting steadily slower.',
    doc: 'flaky-tests#performance',
  },
  'project.timeline': {
    title: 'Timeline markers',
    text: 'Dated events — deploys, config changes, infra migrations, incidents — overlaid as vertical lines on the trend charts, so you can tell whether a change moved your results or performance. Markers can be scoped to an environment; some are detected automatically when tooling versions change between runs.',
    doc: 'timeline-markers',
    envVars: ['PIWI_AUTO_MARKERS'],
  },
  'project.slowest-tests': {
    title: 'Slowest tests',
    text: 'The tests taking the most time, ranked. Optimizing the top entries shortens your overall run the fastest.',
    doc: 'flaky-tests#performance',
  },
  'project.slow-endpoints': {
    title: 'Slow endpoints',
    text: 'Backend routes exercised during a run, aggregated per route and ranked by time. Needs the Piwi capture fixtures. Pick a run to inspect its endpoint timings.',
    doc: 'flaky-tests#performance',
  },
  'project.status-line': {
    title: 'Project status',
    text: 'The project’s condition at a glance: the latest run and its age, the pass rate over the last 20 runs, and the open clusters, flaky and quarantined counts. Each figure links to the tab that holds it.',
    doc: 'ui-overview#project-detail',
  },
  'project.filters': {
    title: 'Filters',
    text: 'Environment, branch and full-runs-only scope every list on the page — the runs table, the trend chart, the flaky analysis and performance. The choice is remembered per project.',
    doc: 'ui-overview#project-detail',
  },
  'project.test-cases': {
    title: 'Tests',
    text: 'Every distinct test in the project with its executed-only pass rate, result breakdown and average duration across runs. Search by title or file, filter by status, and group by spec file to see each file’s health. Tests not run within the selected age window are hidden by default (last 30 days) — pick "All time" to see obsolete ones. Click a test to see its full history.',
    doc: 'ui-overview#project-detail',
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
  'project.ci-rerun': {
    title: 'CI re-run',
    text: 'Lets a reporter or admin re-run a cluster’s affected tests in CI straight from its page — a workflow_dispatch on GitHub, a pipeline on GitLab, a custom pipeline on Bitbucket — passing the retry arguments through the input/variable you name. Uses the project’s SCM token (which needs write scope) and is off until you fill in your provider’s block.',
    doc: 'ci#re-run-from-the-dashboard',
  },
  'project.local-folder': {
    title: 'Linked local folder',
    text: 'The checkout on this machine that produces this project’s runs. Linking it enables running tests from the app and opening files in your IDE. The link is stored on this machine only — never on the server.',
    doc: 'desktop#running-tests-from-the-app',
  },

  // ── Test run detail ───────────────────────────────────────────────────
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
    title: 'Tests',
    text: 'Every execution in this run. Group by cluster, file, file and describe block, or none; search title, path and error text; filter by status, browser, new regressions and newly flaky.',
    doc: 'ui-overview#test-run-detail',
  },
  'run.changes': {
    title: 'Changes',
    text: 'What differs between this run and one baseline — the last passing run on the same branch by default, or the run you pick. The tests that started or stopped failing, the ones that got slower or faster, the commits landed since the baseline, and the environment fields that moved. New failures are counted once against that baseline.',
    doc: 'flaky-tests#changes',
  },
  'run.timeline': {
    title: 'Workers timeline',
    text: 'When each test ran on each parallel worker. Gaps and long bars reveal poor parallelization or a single slow test stalling a shard.',
    doc: 'ui-overview#test-run-detail',
  },
  // ── Single execution (test-run-case) ──────────────────────────────────
  'case.headline': {
    title: 'Failure headline',
    text: 'What broke, in one sentence built from the Playwright error itself: the locator, the last state its call log reported, the expected and received values, the timeout. The chips say why (new regression, passed on retry), since when and on which commit, how many other tests in the run share the cause, and who owns the test. The raw error is right below, verbatim.',
    doc: 'evidence#one-execution-diagnosis-first',
  },
  'case.clues': {
    title: 'Clues',
    text: 'Deterministic findings a set of rules correlate from the evidence already captured — a request that failed just before the click, a console error naming the failing element, a renamed element, the page ending on a login route, the previous test on this worker failing. No model runs; each clue is ranked by strength and cites the evidence section it came from, so a click jumps straight to it. The same clues are fed to the AI diagnosis as evidence to confirm or refute.',
    doc: 'evidence#clues',
  },
  'case.fix': {
    title: 'Fix',
    text: 'Everything to do about this failure in one place — the locator fix for a broken locator, a pointer to the cluster’s fix plan, the diagnosis, how to verify a fix, and the tests this failure blocked. Each part shows only when it applies.',
    doc: 'ai-diagnosis#fix-plans',
  },
  'fix.reproduce': {
    title: 'Reproduce',
    text: 'A copy-paste recipe that reproduces the failure locally — check out the failing commit, install the run’s Playwright version and browser, and run exactly the failing test — plus a generated git bisect between the last green and the failing commit to find what broke it. Both come in Linux/macOS and Windows forms. The bisect needs a last-green commit and an SCM connection; without them it says so. In the desktop app, Reproduce here and Find the breaking commit here run the recipe and drive the bisect for you in a throwaway git worktree, without touching your checkout.',
    doc: 'ai-diagnosis#reproduce-and-bisect',
  },
  'case.test-source': {
    title: 'Test source',
    text: 'The source around the failing line and the callers above it — captured from the failure’s call stack — so you can read where it broke, and the code that led there, without opening your editor. When the execution has a trace, this deepens into the complete call stack with the real source of every frame, read from the trace’s embedded files.',
    doc: 'evidence#trace-powered-deep-views',
  },
  'export.offline': {
    // Deliberately avoids the word "Export": the hint sits beside a button with
    // that label, and a substring role query would match both.
    title: 'Reading this offline',
    text: 'Takes this investigation out of the dashboard as a file that needs no network and no Piwi server. HTML is one self-contained page with screenshots and video embedded; ZIP adds the raw artifacts — trace archives, full-size video, logs — plus a machine-readable data.json; PDF is the HTML printed from your browser. Evidence past the size budget is listed in the report as omitted rather than dropped quietly.',
    doc: 'offline-export',
    envVars: ['PIWI_EXPORT_MAX_INLINE_BYTES', 'PIWI_EXPORT_MAX_BYTES', 'PIWI_EXPORT_MAX_CASES'],
  },
  'case.timeline': {
    title: 'Failure timeline',
    text: 'One time axis that places this execution’s steps, console entries, network requests and backend log entries on the same clock, with a marker at the moment of failure. The default view is the window around the failed step (10s before, 2s after); switch to “Whole test” to see everything. The list below reads it chronologically — click a line to jump to that step, console entry or request. When a run’s reporter recorded no step start times, positions are estimated from durations and the card says so.',
    doc: 'evidence#one-execution-diagnosis-first',
  },
  'case.web-vitals': {
    title: 'Web Vitals',
    text: 'Core Web Vitals (LCP, CLS, etc.) captured during the test, measuring real loading and responsiveness of the page under test. When empty, the card says which of three things it means: not captured (add the capture fixtures), captured but nothing recorded, or not applicable (Web Vitals need a Chromium browser).',
    doc: 'capture-fixtures',
  },
  'case.console': {
    title: 'Console output',
    text: 'Browser console messages logged while this test ran — often the first clue for a JavaScript error behind a failure. An empty card says which of three things it means: not captured (add the capture fixtures — links to /setup), captured but the page logged nothing, or not applicable. When a trace but no fixtures were present, the entries are recovered from the trace and marked "derived from the trace".',
    doc: 'capture-fixtures',
  },
  'case.network': {
    title: 'Network requests',
    text: 'HTTP requests the page made during the test, with timing and status — useful for spotting failed or slow calls. When the execution has a trace, the Full trace view shows every request (all resource types) with headers, timing phases, a waterfall and capped body previews; sensitive header values are masked. An empty card distinguishes not captured (add the capture fixtures) from captured-but-nothing-happened; with a trace and no fixtures the list is recovered from the trace and marked "derived from the trace".',
    doc: 'evidence#trace-powered-deep-views',
  },
  'case.aria': {
    title: 'ARIA snapshot',
    text: 'A snapshot of the accessibility tree at the moment of failure — what assistive tech saw, and useful grounding for AI diagnosis. An empty card says whether it was not captured (add the capture fixtures) or captured with nothing to snapshot; with a trace and no fixtures it is recovered from the trace\'s error context and marked "derived from the trace".',
    doc: 'ai-diagnosis#what-a-diagnosis-contains',
  },
  'case.attempts': {
    title: 'Attempts',
    text: 'When a test failed then passed on retry, this compares the failing attempt against the passing one and lists what differed — the error that was there then gone, a request that failed on only one attempt, a console error, a slower step, a duration or page-state change. Each difference links to the evidence it came from. That delta is the flakiness fingerprint, and it feeds the root-cause classifier.',
    doc: 'flaky-tests#flaky-test-detection',
  },

  // ── Test case across runs ─────────────────────────────────────────────
  'case.history-chart': {
    title: 'Duration trend',
    text: 'This test’s duration across recent runs. Rising times or spikes hint at a slowdown or instability.',
    doc: 'flaky-tests#flaky-test-detection',
  },

  // ── Failure clusters ──────────────────────────────────────────────────
  'cluster.concept': {
    title: 'Failure clusters',
    text: 'Failures with the same error fingerprint are grouped into one cluster, so a single root cause shows up once instead of N times.',
    doc: 'ai-diagnosis#failure-clustering',
  },
  'cluster.triage': {
    text: 'Track a cluster’s state: set its status, add triage notes, or extract a subset of failures into a separate cluster.',
  },
  'cluster.owner': {
    title: 'Owner',
    text: 'Who answers for this cluster’s tests. Taken from a `piwi:owner` annotation on the test when present, otherwise derived from the repository’s CODEOWNERS for the spec’s file path. The link filters this project’s test cases to that owner.',
  },
  'cluster.known-issue': {
    title: 'Known issue',
    text: 'Pin the Jira ticket, GitHub issue or PR that tracks this cluster. The link’s key travels with the cluster wherever it is listed, so a triaged cluster shows what is already being done about it.',
  },
  'cluster.fix-verification': {
    title: 'Fix verification',
    text: 'Recorded when a run turns this cluster green — every test it covers ran and passed, in a full suite or a filtered re-run of just those tests: when the fix landed, how long the cluster stayed open, and whether the change matched the diagnosed files. If the failure comes back, the cluster is marked as regressed rather than quietly reopened.',
    doc: 'ai-diagnosis#did-the-fix-work',
  },
  'cluster.fix-plan': {
    title: 'Fix',
    text: 'Everything needed to repair this cluster in one place — the AI diagnosis and its validated patch, the recommended locator fix, the command that verifies the fix, and the whole plan as Markdown. Copy it for a ticket, or let an agent fetch the same plan via the get_fix_plan MCP tool.',
    doc: 'ai-diagnosis#fix-plans',
  },
  'cluster.fixed-before': {
    title: 'Fixed before',
    text: 'Resolved failures that resemble this one — matched on the same error and locator, the same spec or test, and (when embeddings are configured) semantic similarity. Each shows when it was fixed, the resolving commit, how long it stayed open and the triage note, so you can reuse an earlier resolution. "Apply the same triage" copies that note onto this cluster; it never marks a new cluster resolved because an old one was.',
    doc: 'ai-diagnosis#fix-plans',
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
    title: 'Diagnosis',
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

  // ── Notifications / subscribe ─────────────────────────────────────────
  'notifications.subscribe': {
    title: 'Project notifications',
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
    text: 'Destinations an alert can go to — browser, email, Slack or webhook. Create a channel, then subscribe events to it. Administrators can make a channel global (usable by everyone); without authentication every channel is global.',
    doc: 'notifications#channels',
  },
  'notifications.subscriptions': {
    title: 'Subscriptions',
    text: 'Which events (run failed, new cluster, etc.) notify which channel, optionally scoped to one project and filtered. Global subscriptions deliver instance-wide and are managed by administrators.',
    doc: 'notifications#subscriptions',
  },
  'settings.ai-provider': {
    title: 'AI provider',
    text: 'Configure the model providers behind the three AI roles — diagnosis, research and embedding. Each role has its own provider config, or reuses another role’s provider and credentials. Keys are stored encrypted and never returned by the API.',
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
    text: 'An optional cheaper/faster model that pre-analyzes the failure (on a lean view) before the main model writes the final diagnosis. It can use its own provider, and the costly SCM diff is only fetched when it flags a likely regression. It also handles cluster naming and merge adjudication, so configuring a cheap research model routes those utility calls away from the expensive diagnosis model.',
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
      'PIWI_AI_MAX_TRACE_STACK_FRAMES',
      'PIWI_AI_MAX_TRACE_NETWORK_REQUESTS',
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
  'settings.timeout-hygiene': {
    title: 'Timeout hygiene',
    text: 'Thresholds for flagging oversized per-test timeouts and stale test.slow() marks. Opportunities are recomputed at read time, so changes apply to existing runs immediately.',
    doc: 'flaky-tests#performance',
  },
  'settings.pr-feedback': {
    title: 'Pull-request feedback',
    text: 'When a run finishes on a branch with an open pull request, Piwi can post a summary comment — new failures separated from pre-existing ones, with suggested locators — and set a commit status. Needs PIWI_SITE_URL and an SCM token with write access.',
    doc: 'ci#pull-request-feedback',
    envVars: ['PIWI_SITE_URL'],
  },
  'settings.auto-heal': {
    title: 'Auto-heal pull requests',
    text: 'When a locator breaks on the default branch and healing has high-confidence evidence, Piwi opens the fix pull request itself — a deterministic one-line locator edit per broken call site. Off by default, with an explicit per-project allowlist. Needs PIWI_SITE_URL and an SCM token with write access.',
    doc: 'auto-heal',
    envVars: ['PIWI_SITE_URL'],
  },
  'settings.auto-diagnose': {
    title: 'Auto-diagnose',
    text: 'When a run finishes, up to 3 new failure clusters are diagnosed automatically — each diagnosis is one research call (when a research model is configured) plus one diagnosis call — and new clusters get human-readable titles in one batched call. Requires the diagnosis model to be configured.',
    doc: 'ai-diagnosis#enabling-ai-diagnosis',
    envVars: ['PIWI_AI_AUTO_DIAGNOSE'],
  },
  'settings.ai-notifications': {
    title: 'Diagnosis notifications',
    text: 'Show a browser notification when a diagnosis finishes. This is a per-browser preference stored on this device only — it is not shared with other users or saved on the server, and it needs the browser’s notification permission.',
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
    doc: 'authentication#oauth-google-github',
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
  'mcp.skills': {
    title: 'Agent skills',
    text: 'Portable SKILL.md workflow instructions for AI coding agents — investigate a failure, apply a healed locator, stabilize flaky tests. Installed into your test project by the reporter CLI; each one prefers this MCP server and falls back to the dashboard UI.',
    doc: 'mcp#agent-skills',
  },

  // ── Shared ────────────────────────────────────────────────────────────
  'shared.entity-links': {
    title: 'Entity links',
    text: 'Links to external systems (Jira, GitHub, etc.) attached to this item. The provider is detected automatically from the URL.',
  },
  'ide.open': {
    title: 'Open in IDE',
    text: 'Click a source path to open it in your local editor. Set your local workspace folder (so VS Code gets an absolute path) or a JetBrains project name, then pick a method. Auto probes the JetBrains local server first (the only one it can confirm) before falling back to a vscode:// or jetbrains:// launch. These preferences live in this browser only.',
    doc: 'ide-integration',
  },

  // ── Locator healing ────────────────────────────────────────────────────
  'locator-healing': {
    title: 'Locator fix',
    text: 'When a locator breaks after a UI change, Piwi suggests pre-captured alternatives from the last passing run — or from another test in the project that uses the same locator. Each alternative is ranked by stability score — prefer data-testid (100) over CSS classes (10–40). The recommended fix shows the exact one-line edit for the failing test, with a "Copy fix prompt" for an AI coding agent. A "Your pick" badge marks a replacement you confirmed on the failing page: "Pick from snapshot" opens the failure-time DOM and lets you click the intended element, and "Pick from trace" opens the failure trace in the trace viewer, whose Pick locator tool works on the recorded page snapshots.',
    doc: 'reporter#locator-healing',
  },

  // ── Environment diff ────────────────────────────────────────────────────
  'environment-diff': {
    title: 'Environment diff',
    text: 'Compares this execution’s environment (Playwright version, browser config, locale, viewport, CI provider, …) against the same test’s last passing run on the same browser — from the same environment when one exists, then the same branch, then the most recent; the subtitle says when the baseline had to come from another environment. Only changed keys are shown — an empty diff rules out environment drift as the cause.',
  },

  // ── Visual diff ──────────────────────────────────────────────────────────
  'visual-diff': {
    title: 'Visual diff',
    text: 'Pixel-compares the failing screenshot against the same test’s last passing screenshot (same browser, preferring the same environment and then the same branch). Red pixels in the overlay mark what changed. When the two screenshots have different dimensions the ratio is flagged as unreliable.',
  },

  // ── DOM snapshot ─────────────────────────────────────────────────────────
  'dom-snapshot': {
    title: 'DOM snapshot',
    text: 'The page’s HTML around the failing action, rendered from the uploaded Playwright trace — nothing extra is captured. Input values, inline handlers and script bodies are removed; token-shaped strings are masked.',
  },

  // ── Page state ───────────────────────────────────────────────────────────
  'page-state': {
    title: 'App state at test end',
    text: 'URL, history state, storage key names + value lengths, and cookie names + flags captured when the test ended. Values are never captured. Disable with the reporter’s capturePageState option.',
    doc: 'capture-fixtures',
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
