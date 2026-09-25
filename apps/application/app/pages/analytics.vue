<script setup lang="ts">
import type { Component } from 'vue';
import { getAnalyticsWidget, type AnalyticsWidgetId } from '#shared/analytics/registry';
import { analyticsScopeToQuery, hasTestFilter } from '#shared/analytics/scope';
import {
  applyWidgetScope,
  OVERVIEW_DASHBOARD,
  resolveDashboard,
  type ResolvedDashboardWidget,
} from '#shared/analytics/dashboards';
import type { ProjectMenuItem, TestRunForChart } from '~~/types/api';
import {
  AnalyticsStatsRow,
  AnalyticsVerdict,
  AnalyticsProgress,
  AnalyticsRisks,
  MetricTrendChart,
  InsightsFeed,
  PortfolioScorecard,
  PassRateHeatmap,
  CiTimeTrendChart,
  WastedTimeChart,
  GlobalFlakyLeaderboard,
  ClusterLandscape,
  RegressionVelocityChart,
  BrowserMatrix,
  SlowEndpointsTable,
} from '#components';

useHead({ title: 'Analytics - Piwi Dashboard' });

const { state, scope, scopeQuery } = useAnalyticsScope();
const testFilterActive = computed(() => hasTestFilter(scope.value));

// How the scope resolves: period dates, notes, markers for the trends, and the
// options of the Tests filter. The trend charts read it through inject.
const { data: scopeSummary } = await useAnalyticsScopeSummary(() => scopeQuery.value);
provide(ANALYTICS_SCOPE_SUMMARY, scopeSummary);

// Project options for the scope bar (slim list, same source as the sidebar menu).
const { data: availableProjects } = await useFetch('/api/projects/menu', {
  lazy: true,
  server: false,
  default: () => [] as ProjectMenuItem[],
  transform: (r: { items: ProjectMenuItem[] }) => r.items,
});

// Environment options for the scope bar (same source as the home filters).
const { data: recentTestRuns } = await useFetch('/api/test-runs/recent', {
  lazy: true,
  server: false,
  default: () => [] as TestRunForChart[],
  transform: (r: { items: TestRunForChart[] }) => r.items,
});

const availableEnvironments = computed(() => {
  const envSet = new Set<string>();
  for (const run of recentTestRuns.value ?? []) {
    if (run.environment) envSet.add(run.environment);
  }
  return [...envSet].sort();
});

const availableBranches = computed(() => {
  const branchSet = new Set<string>();
  for (const run of recentTestRuns.value ?? []) {
    if (run.branch) branchSet.add(run.branch);
  }
  return [...branchSet].sort();
});

// "Looks empty when it isn't": if the newest run predates the selected window,
// every widget shows zeroes even though there IS history. Detect it and offer to
// widen, rather than leaving the user staring at an empty scorecard.
const newestRunTime = computed(() => {
  const runs = recentTestRuns.value ?? [];
  if (runs.length === 0) return null;
  return Math.max(...runs.map((r) => new Date(r.startTime).getTime()));
});

const windowHidesData = computed(() => {
  if (newestRunTime.value === null) return false; // no runs at all — a genuine empty state
  if (state.value.period === 'all') return false; // already showing everything
  const period = scopeSummary.value?.period;
  if (!period) return false;
  return newestRunTime.value < new Date(period.from).getTime();
});

function widenToAllTime() {
  state.value = { ...state.value, period: 'all' };
}

/**
 * Widget id → component. Keyed by the registry union, so registering a widget
 * without wiring its component (or vice versa) is a compile error.
 */
const WIDGET_COMPONENTS: Record<AnalyticsWidgetId, Component> = {
  stats: AnalyticsStatsRow,
  verdict: AnalyticsVerdict,
  metric: MetricTrendChart,
  progress: AnalyticsProgress,
  risks: AnalyticsRisks,
  insights: InsightsFeed,
  portfolio: PortfolioScorecard,
  'pass-rate-heatmap': PassRateHeatmap,
  'ci-time-trend': CiTimeTrendChart,
  'wasted-time': WastedTimeChart,
  'flaky-leaderboard': GlobalFlakyLeaderboard,
  'cluster-landscape': ClusterLandscape,
  'regression-velocity': RegressionVelocityChart,
  'browser-matrix': BrowserMatrix,
  'slow-endpoints': SlowEndpointsTable,
};

/** The widgets that take their options and title from the dashboard; the others carry their own title. */
const CONFIGURABLE = new Set<AnalyticsWidgetId>(['stats', 'verdict', 'metric', 'progress', 'risks']);

/** The page is the built-in Overview dashboard: its bands and widgets, in order. */
const bands = resolveDashboard(OVERVIEW_DASHBOARD);

/** A widget's request: the page scope, narrowed or re-perioded by the widget's own scope. */
function widgetQuery(widget: ResolvedDashboardWidget): Record<string, string> {
  if (!widget.available || !widget.scope) return scopeQuery.value;
  const { tz, locale } = scopeQuery.value;
  return {
    ...analyticsScopeToQuery(applyWidgetScope(scope.value, widget.scope)),
    ...(tz ? { tz } : {}),
    ...(locale ? { locale } : {}),
  };
}

function widgetProps(widget: ResolvedDashboardWidget & { available: true }) {
  return CONFIGURABLE.has(widget.type)
    ? { query: widgetQuery(widget), options: widget.options, title: widget.title }
    : { query: widgetQuery(widget) };
}

function ignoresTestFilter(widget: ResolvedDashboardWidget & { available: true }): boolean {
  return testFilterActive.value && !getAnalyticsWidget(widget.type).testFilters;
}
</script>

<template>
  <UDashboardPanel id="analytics">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb :items="[{ label: 'Analytics', icon: 'i-lucide-chart-line', to: '/analytics' }]" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="space-y-6">
        <FilterToolbar>
          <AnalyticsScopeBar
            v-model="state"
            :available-projects="availableProjects"
            :available-environments="availableEnvironments"
            :available-branches="availableBranches"
            :summary="scopeSummary"
          />
        </FilterToolbar>

        <UAlert
          v-if="windowHidesData"
          icon="i-lucide-calendar-off"
          color="warning"
          variant="subtle"
          :title="`No test runs in the selected period (${scopeSummary?.period.label ?? state.period})`"
          :description="`Your most recent run was ${formatRelativeTime(newestRunTime)} — the widgets below look empty because the selected range excludes it.`"
          :actions="[
            { label: 'Show all time', color: 'warning', variant: 'solid', size: 'xs', onClick: widenToAllTime },
          ]"
        />

        <section v-for="band in bands" :key="band.title" class="space-y-3">
          <div>
            <h2 class="text-sm font-semibold uppercase tracking-wide text-dimmed">{{ band.title }}</h2>
            <p v-if="band.description" class="text-sm text-muted">{{ band.description }}</p>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <div
              v-for="widget in band.widgets"
              :key="widget.key"
              :class="widget.size === 'full' ? 'xl:col-span-2' : ''"
            >
              <template v-if="widget.available">
                <p v-if="ignoresTestFilter(widget)" class="text-xs text-muted mb-1">
                  {{ widget.title }} is not narrowed by the test filter.
                </p>
                <component :is="WIDGET_COMPONENTS[widget.type]" v-bind="widgetProps(widget)" />
              </template>
              <EmptyState v-else icon="i-lucide-circle-slash" :text="widget.reason" />
            </div>
          </div>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
