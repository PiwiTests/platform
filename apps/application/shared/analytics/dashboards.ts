/**
 * Dashboards: named arrangements of widgets in bands, with a default scope.
 *
 * The analytics page renders the built-in Overview; a quality report renders
 * any dashboard as a document (`shared/reports/collect.ts`), and the
 * executive, engineering, team and gaps digest dashboards exist for that. Built-in dashboards are defined
 * here in code and can only be duplicated; saved dashboards reuse the same
 * definition shape.
 */
import type { AnalyticsScope } from './scope';
import { DEFAULT_ANALYTICS_SCOPE } from './scope';
import {
  getAnalyticsWidget,
  isAnalyticsWidgetId,
  parseWidgetOptions,
  WidgetOptionsError,
  type AnalyticsWidgetId,
} from './registry';

export interface DashboardWidget {
  /** Stable inside the dashboard: URLs and edits address it. */
  key: string;
  /** An entry of the widget registry. */
  type: AnalyticsWidgetId;
  /** Replaces the registry title. */
  title?: string;
  size: 'full' | 'half';
  /** Checked against the widget's options schema. */
  options?: Record<string, unknown>;
  /** May replace the period; may only narrow the filters. */
  scope?: Partial<AnalyticsScope>;
}

export interface DashboardBand {
  title: string;
  description?: string;
  widgets: DashboardWidget[];
}

export interface DashboardDefinition {
  v: 1;
  /** Default filters, period, comparison and granularity. */
  scope: AnalyticsScope;
  bands: DashboardBand[];
}

export const OVERVIEW_DASHBOARD: DashboardDefinition = {
  v: 1,
  scope: {
    period: { kind: 'rolling', days: 30 },
    comparison: { kind: 'previous' },
    granularity: 'auto',
    defaultBranchOnly: true,
    fullRunsOnly: true,
  },
  bands: [
    {
      title: 'Where things stand',
      description: 'The state of every project right now.',
      widgets: [
        {
          key: 'headline',
          type: 'stats',
          size: 'full',
          options: {
            metrics: [
              'test-pass-rate',
              'run-success-rate',
              'flaky-tests',
              'wasted-ci-minutes',
              'open-failure-causes',
              'median-time-to-fix',
            ],
          },
        },
        { key: 'portfolio', type: 'portfolio', size: 'full' },
        { key: 'insights', type: 'insights', size: 'half' },
        { key: 'heatmap', type: 'pass-rate-heatmap', size: 'half' },
      ],
    },
    {
      title: 'Where the pain is',
      description: 'What is costing you the most time and attention.',
      widgets: [
        { key: 'clusters', type: 'cluster-landscape', size: 'half' },
        { key: 'flaky', type: 'flaky-leaderboard', size: 'half' },
        { key: 'wasted', type: 'wasted-time', size: 'half' },
      ],
    },
    {
      title: 'Which way it is going',
      description: 'Movement over the selected period.',
      widgets: [
        {
          key: 'pass-rate-trend',
          type: 'metric',
          size: 'full',
          title: 'Pass rate over time',
          options: { metric: 'test-pass-rate', display: 'line' },
        },
        { key: 'regressions', type: 'regression-velocity', size: 'half' },
        { key: 'ci-time', type: 'ci-time-trend', size: 'half' },
      ],
    },
    {
      title: 'Detail',
      description: 'Breakdowns to reach for once you know what you are chasing.',
      widgets: [
        { key: 'browsers', type: 'browser-matrix', size: 'half' },
        { key: 'endpoints', type: 'slow-endpoints', size: 'full' },
      ],
    },
  ],
};

/** The report's opening: the verdict, the six tiles, the trend, the changes, what is being done and the risks. */
const REPORT_SUMMARY_BANDS: DashboardBand[] = [
  {
    title: 'Where things stand',
    description: 'The state of the projects in scope, against the comparison period.',
    widgets: [
      { key: 'verdict', type: 'verdict', size: 'full' },
      {
        key: 'headline',
        type: 'stats',
        size: 'full',
        options: {
          metrics: [
            'test-pass-rate',
            'run-success-rate',
            'flaky-tests',
            'wasted-ci-minutes',
            'open-failure-causes',
            'suite-size',
          ],
          companions: { 'open-failure-causes': 'median-time-to-fix' },
        },
      },
    ],
  },
  {
    title: 'Which way it is going',
    description: 'Movement over the period.',
    widgets: [
      {
        key: 'trend',
        type: 'metric',
        size: 'full',
        title: 'Pass rate over time',
        options: { metric: 'test-pass-rate', display: 'line' },
      },
      { key: 'changes', type: 'insights', size: 'full', title: 'What changed' },
    ],
  },
  {
    title: 'What is being done',
    description: 'Fixes, triage and the risks still open.',
    widgets: [
      { key: 'progress', type: 'progress', size: 'half' },
      { key: 'risks', type: 'risks', size: 'half' },
    ],
  },
];

/** For stakeholders: plain words, no locators, no stack traces. */
export const EXECUTIVE_DASHBOARD: DashboardDefinition = {
  v: 1,
  scope: { ...OVERVIEW_DASHBOARD.scope },
  bands: REPORT_SUMMARY_BANDS,
};

/** For the team that owns the suite: the executive report, then the analytics page in reading order. */
export const ENGINEERING_DASHBOARD: DashboardDefinition = {
  v: 1,
  scope: { ...OVERVIEW_DASHBOARD.scope },
  bands: [
    ...REPORT_SUMMARY_BANDS,
    {
      title: 'Where the pain is',
      description: 'What is costing the most time and attention.',
      widgets: [
        { key: 'flaky', type: 'flaky-leaderboard', size: 'full' },
        { key: 'clusters', type: 'cluster-landscape', size: 'full' },
        { key: 'wasted', type: 'wasted-time', size: 'full' },
      ],
    },
    {
      title: 'Trends',
      description: 'Regressions and CI time over the period.',
      widgets: [
        { key: 'regressions', type: 'regression-velocity', size: 'half' },
        { key: 'ci-time', type: 'ci-time-trend', size: 'half' },
      ],
    },
    {
      title: 'Detail',
      description: 'Browsers and shared endpoints.',
      widgets: [
        { key: 'browsers', type: 'browser-matrix', size: 'full' },
        { key: 'endpoints', type: 'slow-endpoints', size: 'full' },
      ],
    },
    {
      title: 'Scenario gaps',
      description: 'What the tests do not reach yet, from the Test Map.',
      widgets: [{ key: 'gaps', type: 'scenario-gaps', size: 'full' }],
    },
  ],
};

/**
 * The engineering dashboard for one team: the same widgets, and a schedule
 * sets the owner test filter, so each team receives the numbers of its own
 * tests.
 */
export const TEAM_DASHBOARD: DashboardDefinition = {
  v: 1,
  scope: { ...OVERVIEW_DASHBOARD.scope },
  bands: ENGINEERING_DASHBOARD.bands,
};

/** The Test Map's weekly digest: the top new gaps of each project, then where the gaps stand. */
export const GAPS_DIGEST_DASHBOARD: DashboardDefinition = {
  v: 1,
  scope: { ...OVERVIEW_DASHBOARD.scope, period: { kind: 'rolling', days: 7 } },
  bands: [
    {
      title: 'New scenario gaps',
      description: 'The top new gaps of each project in the period.',
      widgets: [{ key: 'new-gaps', type: 'new-gaps', size: 'full' }],
    },
    {
      title: 'Where the gaps stand',
      description: 'Open gaps by class and by feature, and the gaps closed.',
      widgets: [{ key: 'gaps', type: 'scenario-gaps', size: 'full' }],
    },
  ],
};

export type BuiltinDashboardKey = 'overview' | 'executive' | 'engineering' | 'team' | 'gaps-digest';

export interface BuiltinDashboard {
  key: BuiltinDashboardKey;
  name: string;
  description: string;
  definition: DashboardDefinition;
  /**
   * What the dashboard needs from the scope: `owner`, an owner test filter (the
   * team dashboard); `test-map`, the Test Map active in a project of the scope.
   */
  requires?: 'owner' | 'test-map';
}

export const BUILTIN_DASHBOARDS: readonly BuiltinDashboard[] = [
  {
    key: 'overview',
    name: 'Overview',
    description: 'The analytics page: every widget, in its four bands.',
    definition: OVERVIEW_DASHBOARD,
  },
  {
    key: 'executive',
    name: 'Executive',
    description: 'For stakeholders: a verdict, six numbers, the trend, what is being done and the risks.',
    definition: EXECUTIVE_DASHBOARD,
  },
  {
    key: 'engineering',
    name: 'Engineering',
    description: 'For the team that owns the suite: the executive report, then flaky tests, clusters and detail.',
    definition: ENGINEERING_DASHBOARD,
  },
  {
    key: 'team',
    name: 'Team',
    description: 'The engineering dashboard for one team: only the tests an owner holds.',
    definition: TEAM_DASHBOARD,
    requires: 'owner',
  },
  {
    key: 'gaps-digest',
    name: 'Gaps digest',
    description: 'The Test Map’s weekly digest: the top new scenario gaps of each project, then where the gaps stand.',
    definition: GAPS_DIGEST_DASHBOARD,
    requires: 'test-map',
  },
];

/**
 * The built-in dashboards a scope can render: the team dashboard needs an
 * owner test filter, the gaps digest a Test Map that is not declined.
 */
export function offeredDashboards(opts: { hasOwner: boolean; testMapHidden: boolean }): BuiltinDashboard[] {
  return BUILTIN_DASHBOARDS.filter(
    (d) => (d.requires !== 'owner' || opts.hasOwner) && (d.requires !== 'test-map' || !opts.testMapHidden),
  );
}

export function isBuiltinDashboardKey(value: unknown): value is BuiltinDashboardKey {
  return typeof value === 'string' && BUILTIN_DASHBOARDS.some((d) => d.key === value);
}

export function getBuiltinDashboard(key: BuiltinDashboardKey): BuiltinDashboard {
  return BUILTIN_DASHBOARDS.find((d) => d.key === key)!;
}

// ── Validation ───────────────────────────────────────────────────────────────

/** A widget ready to render: title resolved, options checked and defaulted. */
export type ResolvedDashboardWidget =
  | {
      key: string;
      available: true;
      type: AnalyticsWidgetId;
      title: string;
      size: 'full' | 'half';
      options: Record<string, unknown>;
      scope?: Partial<AnalyticsScope>;
    }
  | { key: string; available: false; title: string; size: 'full' | 'half'; reason: string };

export interface ResolvedDashboardBand {
  title: string;
  description?: string;
  widgets: ResolvedDashboardWidget[];
}

export const UNAVAILABLE_WIDGET = 'This widget is no longer available.';

/**
 * Check a definition against the widget registry: every known widget gets its
 * registry title unless it has its own and its options defaulted; a widget a
 * later release removed, or with options its schema refuses, renders as a
 * notice instead of breaking the dashboard.
 */
export function resolveDashboard(definition: DashboardDefinition): ResolvedDashboardBand[] {
  return definition.bands.map((band) => ({
    title: band.title,
    ...(band.description ? { description: band.description } : {}),
    widgets: band.widgets.map((widget): ResolvedDashboardWidget => {
      const type = widget.type as unknown;
      if (!isAnalyticsWidgetId(type)) {
        return {
          key: widget.key,
          available: false,
          title: widget.title ?? 'Widget',
          size: widget.size,
          reason: UNAVAILABLE_WIDGET,
        };
      }
      const title = widget.title ?? getAnalyticsWidget(type).title;
      try {
        return {
          key: widget.key,
          available: true,
          type,
          title,
          size: widget.size,
          options: parseWidgetOptions(type, widget.options ?? {}),
          ...(widget.scope ? { scope: widget.scope } : {}),
        };
      } catch (error) {
        if (!(error instanceof WidgetOptionsError)) throw error;
        return { key: widget.key, available: false, title, size: widget.size, reason: error.message };
      }
    }),
  }));
}

function narrowList<T>(base: T[] | undefined, override: T[] | undefined): T[] | undefined {
  if (!override || override.length === 0) return base;
  if (!base || base.length === 0) return override;
  return base.filter((v) => override.includes(v));
}

/**
 * A widget's scope: its own period, comparison and granularity replace the
 * dashboard's; its filters only narrow (a list filter intersects, a test
 * filter applies when the dashboard has none), so what a dashboard covers can
 * be read off its scope bar.
 */
export function applyWidgetScope(base: AnalyticsScope, override: Partial<AnalyticsScope> | undefined): AnalyticsScope {
  if (!override) return base;
  const scope: AnalyticsScope = {
    ...base,
    period: override.period ?? base.period,
    comparison: override.comparison ?? base.comparison,
    granularity: override.granularity ?? base.granularity,
    defaultBranchOnly: base.defaultBranchOnly || override.defaultBranchOnly === true,
    fullRunsOnly: base.fullRunsOnly || override.fullRunsOnly === true,
  };
  const lists = ['projectIds', 'projectTags', 'environments', 'branches', 'browsers'] as const;
  for (const key of lists) {
    const value = narrowList<any>(base[key], override[key]);
    if (value) (scope as any)[key] = value;
  }
  if (!base.selection && override.selection) scope.selection = override.selection;
  if (!base.tests && override.tests) scope.tests = override.tests;
  return scope;
}

/** The default scope of a dashboard, falling back to the analytics default. */
export function dashboardScope(definition: DashboardDefinition): AnalyticsScope {
  return { ...DEFAULT_ANALYTICS_SCOPE, ...definition.scope };
}
