<script setup lang="ts">
const route = useRoute()
const testCaseId = route.params.id

const { data: testCase, refresh } = await useFetch(`/api/test-cases/${testCaseId}`)

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
  <UDashboardPanel id="test-case-detail">
    <template #header>
      <UDashboardNavbar title="Test Case Details">
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
        <UButton :to="`/test-runs/${testCase?.testRun?.id}`" icon="i-lucide-arrow-left" variant="ghost" size="sm">
          Back to Test Run
        </UButton>

        <UCard>
          <template #header>
            <div class="flex justify-between items-center">
              <h2 class="text-xl font-semibold">Test Case #{{ testCase?.id }}</h2>
              <UBadge v-if="testCase" :color="getStatusColor(testCase.status)" size="lg">
                {{ testCase.status }}
              </UBadge>
            </div>
          </template>

          <div class="space-y-4">
            <div>
              <p class="text-sm text-gray-500">Title</p>
              <p class="font-medium text-lg">{{ testCase?.title }}</p>
            </div>

            <div v-if="testCase?.location">
              <p class="text-sm text-gray-500">Location</p>
              <code class="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded block">{{ testCase.location }}</code>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p class="text-sm text-gray-500">Duration</p>
                <p class="font-medium">{{ formatDuration(testCase?.duration) }}</p>
              </div>
              <div>
                <p class="text-sm text-gray-500">Retries</p>
                <p class="font-medium">{{ testCase?.retries }}</p>
              </div>
              <div>
                <p class="text-sm text-gray-500">Status</p>
                <p class="font-medium">{{ testCase?.status }}</p>
              </div>
            </div>

            <div v-if="testCase?.error" class="pt-4 border-t">
              <p class="text-sm text-gray-500 mb-2">Error Details</p>
              <pre class="text-sm bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 p-4 rounded overflow-x-auto">{{ testCase.error }}</pre>
            </div>
          </div>
        </UCard>

        <UCard v-if="testCase?.traces && testCase.traces.length > 0">
          <template #header>
            <h3 class="text-lg font-medium">Traces</h3>
          </template>

          <div class="space-y-2">
            <div v-for="trace in testCase.traces" :key="trace.id" class="p-3 bg-gray-50 dark:bg-gray-800 rounded">
              <div class="flex items-center justify-between">
                <div>
                  <p class="text-sm font-medium">Trace #{{ trace.id }}</p>
                  <code class="text-xs text-gray-600 dark:text-gray-400">{{ trace.tracePath }}</code>
                </div>
                <p class="text-xs text-gray-500">{{ new Date(trace.createdAt).toLocaleString() }}</p>
              </div>
            </div>
          </div>
        </UCard>

        <div v-else class="text-center py-8 text-gray-500">
          No traces available for this test case.
        </div>
      </div>
    </template>
  </UDashboardPanel>
</template>
