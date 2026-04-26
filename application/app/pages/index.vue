<script setup lang="ts">
import type { ProjectWithStats, TestRunForChart } from '~~/types/api'

useHead({ title: 'Playwright Dashboard' })

const { data: projects } = await useFetch<ProjectWithStats[]>('/api/projects')

const stats = computed(() => {
  const totalProjects = projects.value?.length || 0
  const totalRuns = projects.value?.reduce((sum, p) => sum + (p.totalRuns || 0), 0) || 0
  const recentRuns = projects.value?.filter(p => p.latestRun).length || 0
  const passedRuns = projects.value?.filter(p => p.latestRun?.status === 'passed').length || 0
  const totalFlakyTests = projects.value?.reduce((sum, p) => sum + (p.latestRun?.flakyTests || 0), 0) || 0

  // Find slowest project by avg test duration in latest run
  const projectsWithPerf = projects.value?.filter(p => p.latestRun?.avgTestDuration) || []
  const slowestProject = projectsWithPerf.sort((a, b) =>
    (b.latestRun?.avgTestDuration || 0) - (a.latestRun?.avgTestDuration || 0)
  )[0]

  const statItems: { label: string, value: string | number, icon: string }[] = [
    { label: 'Total projects', value: totalProjects, icon: 'i-lucide-folder' },
    { label: 'Total test runs', value: totalRuns, icon: 'i-lucide-play-circle' },
    { label: 'Active projects', value: recentRuns, icon: 'i-lucide-activity' },
    { label: 'Passing projects', value: passedRuns, icon: 'i-lucide-check-circle' },
    { label: 'Flaky tests', value: totalFlakyTests, icon: 'i-lucide-alert-triangle' }
  ]

  if (slowestProject) {
    statItems.push({
      label: 'Slowest project',
      value: slowestProject.label || slowestProject.name,
      icon: 'i-lucide-gauge'
    })
  }

  return statItems
})

const recentProjects = computed(() => {
  return projects.value?.slice(0, 5) || []
})

// Aggregate all test runs from all projects for the overview chart
const allTestRuns = computed(() => {
  if (!projects.value) return []

  const runs: TestRunForChart[] = []
  projects.value.forEach((project) => {
    if (project.latestRun) {
      runs.push({
        id: project.latestRun.id,
        status: project.latestRun.status,
        startTime: project.latestRun.startTime,
        passedTests: project.latestRun.passedTests || 0,
        failedTests: project.latestRun.failedTests || 0,
        skippedTests: project.latestRun.skippedTests || 0,
        flakyTests: project.latestRun.flakyTests || 0,
        totalTests: project.latestRun.totalTests || 0
      })
    }
  })

  return runs.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime())
})
</script>

<template>
  <UDashboardPanel id="home">
    <template #header>
      <UDashboardNavbar title="Playwright Dashboard">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <UBreadcrumb :items="[{ label: 'Home', icon: 'i-lucide-house', to: '/' }]" />
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-6">
        <!-- Stats Overview -->
        <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
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
              Overview of test results across all projects
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
              <UBadge v-if="project.latestRun" :color="project.latestRun.status === 'passed' ? 'success' : 'error'">
                {{ project.latestRun.status }}
              </UBadge>
            </div>

            <div v-if="recentProjects.length === 0" class="text-center py-8 text-gray-500">
              No projects yet. Submit test results via the API to get started.
            </div>
          </div>
        </UCard>

        <!-- Getting Started -->
        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">
              Getting started
            </h2>
          </template>

          <div class="space-y-4">
            <p>Submit test results to the dashboard using the REST API:</p>
            <pre class="bg-gray-100 dark:bg-gray-800 p-4 rounded text-sm overflow-x-auto"><code>POST /api/test-runs/submit
{
  "projectName": "my-project",
  "status": "passed",
  "startTime": "2024-01-01T00:00:00Z",
  "duration": 120000,
  "totalTests": 10,
  "passedTests": 10,
  "failedTests": 0,
  "testCases": [...]
}</code></pre>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
