/**
 * UI copy for the Setup page's capability ladder.
 *
 * Single source of truth for what each optional capability is, why you'd want
 * it, and how to switch it on. Keyed by `SetupCapabilityId` so a capability
 * added to the detection handler without copy here (or vice versa) is a
 * compile error.
 *
 * Ordered deliberately: the ladder runs from "results arriving at all" through
 * the capabilities that build on each other (fixtures → locator healing) to
 * the optional extras. That order is the answer to "what should I do next?",
 * so it is the order the page renders.
 */
import type { SetupCapabilityId } from '#shared/handlers/setup-status';

export interface SetupCapabilityCopy {
  id: SetupCapabilityId;
  title: string;
  /** One line: what it gives you. */
  summary: string;
  /** How to switch it on, when inactive. */
  how: string;
  icon: string;
  /** Docs page (+ optional `#anchor`), passed through `DocLink`. */
  doc?: string;
  /** In-app route that configures it, when there is one. */
  to?: string;
  /** Label for `to`. */
  toLabel?: string;
  /** Shown instead of "Not active yet" — some capabilities are genuinely optional. */
  optional?: boolean;
}

export const SETUP_CAPABILITIES: SetupCapabilityCopy[] = [
  {
    id: 'reporter',
    title: 'Results arriving',
    summary: 'Your Playwright runs are reaching this dashboard and their history is being kept.',
    how: 'Follow the four steps above to add the reporter to your Playwright config.',
    icon: 'i-lucide-antenna',
    doc: 'guide/reporter',
  },
  {
    id: 'fixtures',
    title: 'Capture fixtures',
    summary:
      'Network timing, Web Vitals, console errors and ARIA snapshots, captured per test. Powers slow endpoints, performance trends and the richer AI diagnosis context.',
    how: 'Extend your Playwright `test` with `piwiFixtures` — see "Go further" above.',
    icon: 'i-lucide-radio',
    doc: 'guide/capture-fixtures',
  },
  {
    id: 'locator-healing',
    title: 'Locator healing',
    summary:
      'When a selector breaks, ranked replacement locators captured from the last passing run — with a recommended fix.',
    how: 'Comes with the capture fixtures; enable those and healing data starts accumulating on passing runs.',
    icon: 'i-lucide-bandage',
    doc: 'guide/capture-fixtures',
  },
  {
    id: 'green-samples',
    title: 'Green page samples',
    summary:
      'A passing-page ARIA snapshot sampled about once a day per test, so a failure can be diffed against the page as it last looked when green.',
    how: 'Comes with the capture fixtures; enable those and samples start accruing on passing runs.',
    icon: 'i-lucide-scan-text',
    doc: 'features/evidence',
  },
  {
    id: 'backend-logs',
    title: 'Backend logs',
    summary:
      'Server-side warnings, errors and spans captured during each test and shown next to the network request that triggered them.',
    how: 'Install a Piwi instrumentation package in the app under test — @piwitests/instrumentation-nitro on npm, or PiwiTests.Instrumentation.AspNetCore on NuGet.',
    icon: 'i-lucide-server',
    doc: 'guide/backend-logs',
    optional: true,
  },
  {
    id: 'clustering',
    title: 'Failure clustering',
    summary: 'Forty red tests collapsed into the three root causes behind them, each triaged once.',
    how: 'Automatic — clusters form as soon as failures with a shared error fingerprint arrive.',
    icon: 'i-lucide-layers',
    doc: 'features/ai-diagnosis',
  },
  {
    id: 'ai',
    title: 'AI diagnosis',
    summary:
      'An LLM you configure explains a cluster against your actual git diff, with its suggested patch validated against your source before you see it.',
    how: 'Configure a provider in Settings — Anthropic, OpenAI, or any OpenAI-compatible endpoint including local models.',
    icon: 'i-lucide-sparkles',
    doc: 'features/ai-diagnosis',
    to: '/settings/ai',
    toLabel: 'Configure AI',
    optional: true,
  },
  {
    id: 'scm',
    title: 'Source control',
    summary:
      'The commits behind a failure, CODEOWNERS-derived ownership, and pull-request feedback on the branch that broke.',
    how: 'Add a repository access token on the project, or globally in Settings.',
    icon: 'i-lucide-git-branch',
    doc: 'features/ai-diagnosis',
    to: '/settings/ai',
    toLabel: 'Add a token',
    optional: true,
  },
  {
    id: 'notifications',
    title: 'Notifications',
    summary: 'Email, Slack, webhook and browser channels, with per-project subscriptions and digests.',
    how: 'Add a channel in Settings, then subscribe the projects you care about.',
    icon: 'i-lucide-bell',
    doc: 'features/notifications',
    to: '/settings/notifications',
    toLabel: 'Add a channel',
    optional: true,
  },
  {
    id: 'quarantine',
    title: 'Quarantine',
    summary:
      'A known-bad test keeps running and reporting, but stops failing the CI gate — and earns its way out on a passing streak.',
    how: "Quarantine a test from its test-case page, or from the project's Quarantine tab.",
    icon: 'i-lucide-shield-alert',
    doc: 'features/flaky-tests',
    optional: true,
  },
  {
    id: 'tags',
    title: 'Tags & ownership',
    summary:
      "Playwright's own test tags plus `piwi:owner` / `priority` / `feature` annotations, filterable across the catalog and the flaky leaderboard.",
    how: 'Tag tests in your specs, or define project tags in Settings.',
    icon: 'i-lucide-tags',
    doc: 'guide/reporter',
    to: '/settings/tags',
    toLabel: 'Manage tags',
    optional: true,
  },
  {
    id: 'markers',
    title: 'Timeline markers',
    summary: 'Your deploys and infrastructure changes overlaid on the trend charts, so a step change has a cause.',
    how: "Add a marker from a project's Timeline tab.",
    icon: 'i-lucide-git-commit-horizontal',
    doc: 'features/timeline-markers',
    optional: true,
  },
];
