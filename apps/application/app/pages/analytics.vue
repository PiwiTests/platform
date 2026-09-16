<script setup lang="ts">
import type { Component } from 'vue';
import { ANALYTICS_WIDGETS, ANALYTICS_BANDS, type AnalyticsWidgetId } from '#shared/analytics/registry';
import { MAX_ANALYTICS_DAYS } from '#shared/analytics/scope';
import type { ProjectMenuItem, TestRunForChart } from '~~/types/api';
import {
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

const { state, scopeQuery } = useAnalyticsScope();

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
  if (state.value.days >= MAX_ANALYTICS_DAYS) return false; // already showing everything
  const windowStart = Date.now() - state.value.days * 24 * 60 * 60 * 1000;
  return newestRunTime.value < windowStart;
});

function widenToAllTime() {
  state.value = { ...state.value, days: MAX_ANALYTICS_DAYS };
}

/**
 * Widget id → component. Keyed by the registry union, so registering a widget
 * without wiring its component (or vice versa) is a compile error.
 */
const WIDGET_COMPONENTS: Record<AnalyticsWidgetId, Component> = {
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

/** Widgets grouped into their bands, in registry order, empty bands dropped. */
const bands = computed(() =>
  ANALYTICS_BANDS.map((band) => ({
    ...band,
    widgets: ANALYTICS_WIDGETS.filter((w) => w.band === band.id),
  })).filter((band) => band.widgets.length > 0),
);
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
          />
        </FilterToolbar>

        <UAlert
          v-if="windowHidesData"
          icon="i-lucide-calendar-off"
          color="warning"
          variant="subtle"
          :title="`No test runs in the last ${state.days} days`"
          :description="`Your most recent run was ${formatRelativeTime(newestRunTime)} — the widgets below look empty because the selected range excludes it.`"
          :actions="[
            { label: 'Show all time', color: 'warning', variant: 'solid', size: 'xs', onClick: widenToAllTime },
          ]"
        />

        <section v-for="band in bands" :key="band.id" class="space-y-3">
          <div>
            <h2 class="text-sm font-semibold uppercase tracking-wide text-dimmed">{{ band.label }}</h2>
            <p class="text-sm text-muted">{{ band.description }}</p>
          </div>

          <div class="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <div v-for="widget in band.widgets" :key="widget.id" :class="widget.size === 'full' ? 'xl:col-span-2' : ''">
              <component :is="WIDGET_COMPONENTS[widget.id]" :query="scopeQuery" />
            </div>
          </div>
        </section>
      </div>
    </template>
  </UDashboardPanel>
</template>
