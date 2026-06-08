<script setup lang="ts">
import type { ProjectWithStats, TestRunForChart } from '~~/types/api'

useHead({ title: 'Piwi Dashboard' })

const { data: projects, refresh } = await useFetch<ProjectWithStats[]>('/api/projects')
const { data: recentTestRuns } = await useFetch<TestRunForChart[]>('/api/test-runs/recent')

useRunStream(refresh)

const ACTIVE_WINDOW_DAYS = 7

const stats = computed(() => {
  const totalProjects = projects.value?.length || 0
  const totalRuns = projects.value?.reduce((sum, p) => sum + (p.totalRuns || 0), 0) || 0
  const totalFlakyTests = projects.value?.reduce((sum, p) => sum + (p.latestRun?.flakyTests || 0), 0) || 0

  // Active projects: those with a run in the last N days
  const activeThreshold = Date.now() - ACTIVE_WINDOW_DAYS * 24 * 60 * 60 * 1000
  const activeProjects = projects.value?.filter(p =>
    p.latestRun && new Date(p.latestRun.startTime).getTime() > activeThreshold
  ).length || 0

  // Passing projects: latest run status is 'passed'
  const passedRuns = projects.value?.filter(p => p.latestRun?.status === 'passed').length || 0

  const statItems: { label: string, value: string | number, icon: string, description?: string }[] = [
    { label: 'Total projects', value: totalProjects, icon: 'i-lucide-folder' },
    { label: 'Total test runs', value: totalRuns, icon: 'i-lucide-play-circle' },
    { label: 'Active projects', value: activeProjects, icon: 'i-lucide-activity', description: `Run in last ${ACTIVE_WINDOW_DAYS} days` },
    { label: 'Passing projects', value: passedRuns, icon: 'i-lucide-check-circle', description: 'Latest run passed' },
    { label: 'Flaky tests', value: totalFlakyTests, icon: 'i-lucide-alert-triangle', description: 'In latest runs' }
  ]

  return statItems
})

const recentProjects = computed(() => {
  return projects.value?.slice(0, 5) || []
})

// Use the dedicated recent test runs endpoint for actual time-series data
const allTestRuns = computed(() => {
  return recentTestRuns.value || []
})
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

        <!-- Test Runs Trend Chart -->
        <UCard v-if="allTestRuns.length > 0">
          <template #header>
            <h2 class="text-xl font-semibold">
              Test results trend
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              Test results over time across all projects (last 30 runs)
            </p>
          </template>

          <TestRunsChart :test-runs="allTestRuns" :height="300" />
        </UCard>

        <!-- Recent Projects -->
        <UCard>
          <template #header>
            <div class="flex justify-between items-center">
              <h2 class="text-xl font-semibold">
                Recent projects
              </h2>
              <UButton to="/projects" variant="outline" size="sm">
                View all
              </UButton>
            </div>
          </template>

          <div class="space-y-3">
            <div v-for="project in recentProjects" :key="project.id" class="flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-800 rounded">
              <div>
                <NuxtLink :to="`/projects/${project.id}`" class="font-medium text-primary hover:underline">
                  {{ project.label || project.name }}
                </NuxtLink>
                <div v-if="project.tags && project.tags.length > 0" class="flex flex-wrap gap-1 mt-1">
                  <TagBadge
                    v-for="tag in project.tags"
                    :key="tag.id"
                    :text="tag.text"
                    :color="tag.color"
                  />
                </div>
                <p class="text-sm text-gray-600">
                  {{ project.totalRuns }} test runs
                </p>
              </div>
              <RunStatusBadge v-if="project.latestRun" :status="project.latestRun.status" />
            </div>

            <div v-if="recentProjects.length === 0" class="text-center py-8 text-gray-500">
              No projects yet. Submit test results via the API to get started.
            </div>
          </div>
        </UCard>

        <!-- Getting Started (only shown when no projects exist) -->
        <UCard v-if="!projects || projects.length === 0">
          <template #header>
            <h2 class="text-xl font-semibold">
              Getting started
            </h2>
          </template>

          <div class="flex items-center justify-between">
            <p class="text-gray-600 dark:text-gray-400">
              Learn how to install the reporter and submit test results.
            </p>
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
