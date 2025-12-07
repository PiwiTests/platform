<script setup lang="ts">
const route = useRoute()
const projectId = route.params.id

const { data: project, refresh } = await useFetch(`/api/projects/${projectId}`)

function formatDate(date: string | Date) {
  return new Date(date).toLocaleString()
}

function formatDuration(ms?: number | null) {
  if (!ms) return 'N/A'
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${remainingSeconds}s`
}

function getStatusColor(status: string) {
  switch (status) {
    case 'passed': return 'success'
    case 'failed': return 'error'
    case 'timedout': return 'warning'
    case 'interrupted': return 'warning'
    default: return 'neutral'
  }
}
</script>

<template>
  <UDashboardPanel id="project-detail">
    <template #header>
      <UDashboardNavbar :title="project?.name || 'Project Details'">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            size="md"
            label="Refresh"
            @click="() => refresh()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-4">
        <UButton
          to="/projects"
          icon="i-lucide-arrow-left"
          variant="ghost"
          size="sm"
        >
          Back to Projects
        </UButton>

        <!-- Test Runs Trend Chart -->
        <UCard v-if="project?.testRuns && project.testRuns.length > 0">
          <template #header>
            <h2 class="text-xl font-semibold">
              Test Results Trend
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              Test run statistics over time for {{ project?.name }}
            </p>
          </template>

          <TestRunsChart :test-runs="project.testRuns" :height="300" />
        </UCard>

        <UCard>
          <template #header>
            <div class="flex justify-between items-center">
              <h2 class="text-xl font-semibold">
                {{ project?.name }}
              </h2>
            </div>
            <p v-if="project?.description" class="text-gray-600 mt-2">
              {{ project.description }}
            </p>
          </template>

          <div class="space-y-4">
            <div>
              <h3 class="text-lg font-medium mb-3">
                Test Runs
              </h3>

              <div v-if="project?.testRuns && project.testRuns.length > 0" class="space-y-2">
                <div v-for="run in project.testRuns" :key="run.id" class="p-4 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <div class="flex items-start justify-between">
                    <div class="flex-1">
                      <div class="flex items-center gap-3 mb-2">
                        <NuxtLink :to="`/test-runs/${run.id}`" class="text-primary hover:underline font-medium">
                          Run #{{ run.id }}
                        </NuxtLink>
                        <UBadge :color="getStatusColor(run.status)">
                          {{ run.status }}
                        </UBadge>
                      </div>
                      <div class="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
                        <div>
                          <span class="text-gray-500">Started:</span>
                          <span class="ml-2">{{ formatDate(run.startTime) }}</span>
                        </div>
                        <div>
                          <span class="text-gray-500">Duration:</span>
                          <span class="ml-2">{{ formatDuration(run.duration) }}</span>
                        </div>
                        <div>
                          <span class="text-gray-500">Total:</span>
                          <span class="ml-2">{{ run.totalTests }}</span>
                        </div>
                        <div>
                          <span class="text-gray-500">Passed:</span>
                          <span class="ml-2 text-green-600">{{ run.passedTests }}</span>
                          <span class="text-gray-500 ml-2">Failed:</span>
                          <span class="ml-2 text-red-600">{{ run.failedTests }}</span>
                        </div>
                      </div>
                    </div>
                    <div class="flex gap-2">
                      <UButton :to="`/test-runs/${run.id}`" size="sm" variant="outline">
                        View Details
                      </UButton>
                      <UButton
                        v-if="run.reportPath"
                        :to="`/api/files/${getFileApiPath(run.reportPath)}`"
                        target="_blank"
                        size="sm"
                        variant="outline"
                        icon="i-lucide-external-link"
                      >
                        View Report
                      </UButton>
                    </div>
                  </div>
                </div>
              </div>

              <div v-else class="text-center py-8 text-gray-500">
                No test runs yet for this project.
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
