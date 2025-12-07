<script setup lang="ts">
const route = useRoute()
const runId = route.params.id

const { data: testRun, refresh } = await useFetch(`/api/test-runs/${runId}`)

function formatDuration(ms?: number | null) {
  if (!ms) return 'N/A'
  return `${(ms / 1000).toFixed(2)}s`
}

function getStatusColor(status: string) {
  switch (status) {
    case 'passed': return 'success'
    case 'failed': return 'error'
    case 'timedout': return 'warning'
    case 'skipped': return 'neutral'
    default: return 'neutral'
  }
}
</script>

<template>
  <UDashboardPanel id="test-run-detail">
    <template #header>
      <UDashboardNavbar title="Test Run Details">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton icon="i-lucide-refresh-cw" size="md" @click="() => refresh()" label="Refresh" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-4">
        <UButton :to="`/projects/${testRun?.project?.id}`" icon="i-lucide-arrow-left" variant="ghost" size="sm">
          Back to Project
        </UButton>

        <UCard>
          <template #header>
            <div class="flex justify-between items-center">
              <h2 class="text-xl font-semibold">Test Run #{{ testRun?.id }}</h2>
              <UBadge v-if="testRun" :color="getStatusColor(testRun.status)" size="lg">
                {{ testRun.status }}
              </UBadge>
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid grid-cols-2 md:grid-cols-4 gap-4">
              <div>
                <p class="text-sm text-gray-500">Project</p>
                <p class="font-medium">{{ testRun?.project?.name }}</p>
              </div>
              <div>
                <p class="text-sm text-gray-500">Total Tests</p>
                <p class="font-medium">{{ testRun?.totalTests }}</p>
              </div>
              <div>
                <p class="text-sm text-gray-500">Passed</p>
                <p class="font-medium text-green-600">{{ testRun?.passedTests }}</p>
              </div>
              <div>
                <p class="text-sm text-gray-500">Failed</p>
                <p class="font-medium text-red-600">{{ testRun?.failedTests }}</p>
              </div>
              <div>
                <p class="text-sm text-gray-500">Skipped</p>
                <p class="font-medium">{{ testRun?.skippedTests }}</p>
              </div>
              <div>
                <p class="text-sm text-gray-500">Duration</p>
                <p class="font-medium">{{ formatDuration(testRun?.duration) }}</p>
              </div>
              <div>
                <p class="text-sm text-gray-500">Start Time</p>
                <p class="font-medium">{{ testRun?.startTime ? new Date(testRun.startTime).toLocaleString() : 'N/A' }}</p>
              </div>
            </div>

            <div v-if="testRun?.reportPath" class="pt-4 border-t">
              <p class="text-sm text-gray-500 mb-2">HTML Report</p>
              <div class="flex items-center gap-2">
                <code class="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded flex-1">{{ testRun.reportPath }}</code>
                <UButton 
                  :to="`/api/files/${getFileApiPath(testRun.reportPath)}`" 
                  target="_blank"
                  size="sm"
                  icon="i-lucide-external-link"
                >
                  View Report
                </UButton>
              </div>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h3 class="text-lg font-medium">Test Cases</h3>
          </template>

          <div v-if="testRun?.testCases && testRun.testCases.length > 0" class="space-y-2">
            <div v-for="testCase in testRun.testCases" :key="testCase.id" class="p-4 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <div class="flex items-center gap-3 mb-2">
                    <NuxtLink :to="`/test-cases/${testCase.id}`" class="text-primary hover:underline font-medium">
                      {{ testCase.title }}
                    </NuxtLink>
                    <UBadge :color="getStatusColor(testCase.status)">
                      {{ testCase.status }}
                    </UBadge>
                  </div>
                  <div class="flex gap-4 text-sm text-gray-600 dark:text-gray-400">
                    <span v-if="testCase.location">{{ testCase.location }}</span>
                    <span>Duration: {{ formatDuration(testCase.duration) }}</span>
                    <span v-if="testCase.retries > 0">Retries: {{ testCase.retries }}</span>
                  </div>
                </div>
                <UButton :to="`/test-cases/${testCase.id}`" size="sm" variant="outline">
                  View Details
                </UButton>
              </div>
            </div>
          </div>

          <div v-else class="text-center py-8 text-gray-500">
            No test cases recorded for this run.
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
