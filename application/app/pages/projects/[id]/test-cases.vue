<script setup lang="ts">
const route = useRoute()
const projectId = route.params.id

interface TestCaseWithStats {
  id: number
  filePath: string
  title: string
  totalRuns: number
  passedRuns: number
  failedRuns: number
  skippedRuns: number
  timedOutRuns: number
  flakyRuns: number
  avgDuration: number
  lastRun: number
  lastStatus: string
}

const { data: testCases, refresh } = await useFetch<TestCaseWithStats[]>(`/api/projects/${projectId}/test-cases`)
const { data: project } = await useFetch(`/api/projects/${projectId}`)

function formatDuration(ms?: number | null) {
  if (!ms) return 'N/A'
  return `${(ms / 1000).toFixed(2)}s`
}

function formatDate(timestamp?: number | null) {
  if (!timestamp) return 'N/A'
  return new Date(timestamp).toLocaleString()
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

function getPassRate(testCase: TestCaseWithStats) {
  if (testCase.totalRuns === 0) return 0
  return Math.round((testCase.passedRuns / testCase.totalRuns) * 100)
}

function getTestCaseStatus(testCase: TestCaseWithStats) {
  // If flaky, show as warning
  if (testCase.flakyRuns > 0) {
    return { status: 'flaky', color: 'warning' }
  }
  // Otherwise use last status
  return { status: testCase.lastStatus || 'unknown', color: getStatusColor(testCase.lastStatus || 'unknown') }
}
</script>

<template>
  <UDashboardPanel id="project-test-cases">
    <template #header>
      <UDashboardNavbar :title="`${project?.name || 'Project'} - Test Cases`">
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
          :to="`/projects/${projectId}`"
          icon="i-lucide-arrow-left"
          variant="ghost"
          size="sm"
        >
          Back to Project
        </UButton>

        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">
              Test Cases
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              All test cases in {{ project?.name }} with statistics across all runs
            </p>
          </template>

          <div v-if="testCases && testCases.length > 0" class="space-y-2">
            <div v-for="testCase in testCases" :key="testCase.id" class="p-4 border border-gray-200 dark:border-gray-800 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50">
              <div class="flex items-start justify-between">
                <div class="flex-1">
                  <div class="flex items-center gap-3 mb-2">
                    <h3 class="font-medium">
                      {{ testCase.title }}
                    </h3>
                    <UBadge :color="getTestCaseStatus(testCase).color">
                      {{ getTestCaseStatus(testCase).status }}
                    </UBadge>
                  </div>
                  <div class="text-sm text-gray-600 dark:text-gray-400 mb-3">
                    <code class="text-xs bg-gray-100 dark:bg-gray-800 p-1 rounded">{{ testCase.filePath }}</code>
                  </div>
                  <div class="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-4 text-sm">
                    <div>
                      <span class="text-gray-500">Total Runs:</span>
                      <span class="ml-2 font-medium">{{ testCase.totalRuns }}</span>
                    </div>
                    <div>
                      <span class="text-gray-500">Pass Rate:</span>
                      <span class="ml-2 font-medium" :class="getPassRate(testCase) >= 80 ? 'text-green-600' : getPassRate(testCase) >= 50 ? 'text-yellow-600' : 'text-red-600'">
                        {{ getPassRate(testCase) }}%
                      </span>
                    </div>
                    <div>
                      <span class="text-gray-500">Passed:</span>
                      <span class="ml-2 text-green-600">{{ testCase.passedRuns }}</span>
                    </div>
                    <div>
                      <span class="text-gray-500">Failed:</span>
                      <span class="ml-2 text-red-600">{{ testCase.failedRuns }}</span>
                    </div>
                    <div v-if="testCase.flakyRuns > 0">
                      <span class="text-gray-500">Flaky:</span>
                      <span class="ml-2 text-purple-600">{{ testCase.flakyRuns }}</span>
                    </div>
                    <div v-if="testCase.skippedRuns > 0">
                      <span class="text-gray-500">Skipped:</span>
                      <span class="ml-2">{{ testCase.skippedRuns }}</span>
                    </div>
                    <div>
                      <span class="text-gray-500">Avg Duration:</span>
                      <span class="ml-2">{{ formatDuration(testCase.avgDuration) }}</span>
                    </div>
                    <div>
                      <span class="text-gray-500">Last Run:</span>
                      <span class="ml-2 text-xs">{{ formatDate(testCase.lastRun) }}</span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div v-else class="text-center py-8 text-gray-500">
            No test cases yet for this project.
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
