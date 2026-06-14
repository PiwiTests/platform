<script setup lang="ts">
import type { ProjectWithStats, TestRunForChart } from '~~/types/api';

useHead({ title: 'Piwi Dashboard' });

const { data: projects, refresh: refreshProjects } = await useFetch<ProjectWithStats[]>('/api/projects');
const { data: recentTestRuns, refresh: refreshRecentRuns } = await useFetch<TestRunForChart[]>('/api/test-runs/recent');

useRunStream(() => Promise.all([refreshProjects(), refreshRecentRuns()]));

const ACTIVE_WINDOW_DAYS = 7;

const stats = computed(() => {
  const totalProjects = projects.value?.length || 0;
  const totalRuns = projects.value?.reduce((sum, p) => sum + (p.totalRuns || 0), 0) || 0;
  const totalFlakyTests = projects.value?.reduce((sum, p) => sum + (p.latestRun?.flakyTests || 0), 0) || 0;

  // Active projects: those with a run in the last N days
  const activeThreshold = Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000;
  const activeProjects =
    projects.value?.filter((p) => p.latestRun && new Date(p.latestRun.startTime).getTime() > activeThreshold).length ||
    0;

  // Passing projects: latest run status is 'passed'
  const passedRuns = projects.value?.filter((p) => p.latestRun?.status === 'passed').length || 0;

  const statItems: { label: string; value: string | number; icon: string; description?: string }[] = [
    { label: 'Total projects', value: totalProjects, icon: 'i-lucide-folder' },
    { label: 'Total test runs', value: totalRuns, icon: 'i-lucide-play-circle' },
    {
      label: 'Active projects',
      value: activeProjects,
      icon: 'i-lucide-activity',
      description: `Run in last ${ACTIVE_WINDOW_DAYS} days`,
    },
    { label: 'Passing projects', value: passedRuns, icon: 'i-lucide-check-circle', description: 'Latest run passed' },
    { label: 'Flaky tests', value: totalFlakyTests, icon: 'i-lucide-alert-triangle', description: 'In latest runs' },
  ];

  return statItems;
});

const allProjects = computed(() => {
  return projects.value || [];
});

const recentActiveProjects = computed(() => {
  return [...allProjects.value]
    .filter((p) => p.latestRun)
    .sort((a, b) => new Date(b.latestRun!.startTime).getTime() - new Date(a.latestRun!.startTime).getTime())
    .slice(0, 10);
});

function passRate(run: { passedTests: number; totalTests: number }): number {
  return run.totalTests > 0 ? Math.round((run.passedTests / run.totalTests) * 100) : 0;
}

function passRateClass(run: { passedTests: number; totalTests: number }): string {
  const rate = passRate(run);
  if (rate >= 90) return 'text-green-600 dark:text-green-400';
  if (rate >= 50) return 'text-yellow-600 dark:text-yellow-400';
  return 'text-red-600 dark:text-red-400';
}

function passRateBarClass(run: { passedTests: number; totalTests: number }): string {
  const rate = passRate(run);
  if (rate >= 90) return 'bg-green-500';
  if (rate >= 50) return 'bg-yellow-500';
  return 'bg-red-500';
}

const RUNNING_STATUSES = new Set(['running', 'initialising', 'finalizing']);

// Use the dedicated recent test runs endpoint for actual time-series data
// Running runs are shown first, then the rest in their original order
const allTestRuns = computed(() => {
  const runs = recentTestRuns.value || [];
  return [...runs].sort((a, b) => {
    const aRunning = RUNNING_STATUSES.has(a.status) ? 0 : 1;
    const bRunning = RUNNING_STATUSES.has(b.status) ? 0 : 1;
    return aRunning - bRunning;
  });
});
</script>

<template>
  <UDashboardPanel id="home">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb :items="[{ label: 'Home', icon: 'i-lucide-house', to: '/' }]" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-6">
        <!-- Stats Overview -->
        <div class="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          <UCard v-for="stat in stats" :key="stat.label">
            <div class="flex items-center gap-4">
              <div class="p-3 bg-primary/10 rounded-full">
                <UIcon :name="stat.icon" class="size-6 text-primary" />
              </div>
              <div>
                <p class="text-2xl font-bold">
                  {{ stat.value }}
                </p>
                <p class="text-sm text-gray-600">
                  {{ stat.label }}
                </p>
                <p v-if="stat.description" class="text-xs text-gray-400">
                  {{ stat.description }}
                </p>
              </div>
            </div>
          </UCard>
        </div>

        <!-- Pass rate sparkline -->
        <UCard v-if="allTestRuns.length > 0">
          <template #header>
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-xl font-semibold">Pass rate trend</h2>
                <p class="text-sm text-gray-600 mt-1">Pass rate across all projects (last 30 runs)</p>
              </div>
              <div class="flex items-center gap-4 text-sm">
                <span class="tabular-nums font-medium"
                  >{{
                    Math.round(
                      (allTestRuns.reduce((sum, r) => sum + (r.passedTests || 0), 0) /
                        Math.max(
                          allTestRuns.reduce((sum, r) => sum + (r.totalTests || 0), 0),
                          1,
                        )) *
                        100,
                    )
                  }}%</span
                >
                <span class="text-gray-400 tabular-nums">{{ allTestRuns.length }} runs</span>
              </div>
            </div>
          </template>

          <PassRateChart :test-runs="allTestRuns" />
        </UCard>

        <!-- Projects + Recent activity -->
        <div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <UCard>
            <template #header>
              <div class="flex justify-between items-center">
                <h2 class="text-xl font-semibold">Project health</h2>
                <UButton to="/projects" variant="outline" size="sm"> View all </UButton>
              </div>
            </template>

            <div class="divide-y divide-gray-100 dark:divide-gray-800">
              <div
                v-for="project in recentActiveProjects"
                :key="project.id"
                class="flex items-center gap-4 py-3 first:pt-0 last:pb-0"
              >
                <div class="flex-1 min-w-0">
                  <NuxtLink :to="`/projects/${project.id}`" class="font-medium text-primary hover:underline">
                    {{ project.label || project.name }}
                  </NuxtLink>
                  <div v-if="project.tags && project.tags.length > 0" class="flex flex-wrap gap-1 mt-0.5">
                    <TagBadge v-for="tag in project.tags" :key="tag.id" :text="tag.text" :color="tag.color" />
                  </div>
                </div>

                <div class="flex items-center gap-4 shrink-0">
                  <div class="text-right">
                    <div class="font-semibold tabular-nums" :class="passRateClass(project.latestRun!)">
                      {{ passRate(project.latestRun!) }}%
                    </div>
                    <div class="w-16 h-1.5 bg-gray-100 dark:bg-gray-700 rounded-full mt-0.5 overflow-hidden">
                      <div
                        class="h-full rounded-full transition-all"
                        :class="passRateBarClass(project.latestRun!)"
                        :style="{ width: `${passRate(project.latestRun!)}%` }"
                      />
                    </div>
                  </div>

                  <div class="text-right text-sm min-w-[60px]">
                    <div class="tabular-nums">
                      {{ formatDuration(project.latestRun!.duration) }}
                    </div>
                    <div class="text-xs text-gray-400">{{ project.latestRun!.totalTests }} tests</div>
                  </div>

                  <RunStatusBadge :status="project.latestRun!.status" />
                </div>
              </div>

              <div v-if="allProjects.length === 0" class="text-center py-8 text-gray-500">
                No projects yet. Submit test results via the API to get started.
              </div>
            </div>
          </UCard>

          <UCard v-if="allTestRuns.length > 0">
            <template #header>
              <h2 class="text-xl font-semibold">Recent activity</h2>
            </template>

            <div class="divide-y divide-gray-100 dark:divide-gray-800 text-sm">
              <NuxtLink
                v-for="run in allTestRuns.slice(0, 10)"
                :key="run.id"
                :to="`/test-runs/${run.id}`"
                class="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0 hover:bg-gray-50 dark:hover:bg-gray-800 rounded -mx-2 px-2 transition-colors"
              >
                <RunStatusBadge :status="run.status" />

                <div class="flex-1 min-w-0">
                  <div class="font-medium truncate">{{ run.projectLabel || run.projectName }}</div>
                  <div class="text-xs text-gray-400">Run #{{ run.id }} · {{ formatRelativeTime(run.startTime) }}</div>
                </div>

                <div class="text-right tabular-nums shrink-0">
                  <div :class="passRateClass(run)">{{ passRate(run) }}%</div>
                  <div class="text-xs text-gray-400">{{ formatDuration(run.duration) }}</div>
                </div>
              </NuxtLink>
            </div>
          </UCard>
        </div>

        <!-- Getting Started (only shown when no projects exist) -->
        <UCard v-if="!projects || projects.length === 0">
          <template #header>
            <h2 class="text-xl font-semibold">Getting started</h2>
          </template>

          <div class="flex items-center justify-between">
            <p class="text-gray-600 dark:text-gray-400">Learn how to install the reporter and submit test results.</p>
            <UButton
              to="https://phenx.github.io/piwi-dashboard/getting-started"
              target="_blank"
              icon="i-lucide-external-link"
              trailing
            >
              Read the docs
            </UButton>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
