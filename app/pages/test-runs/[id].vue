<script setup lang="ts">
const route = useRoute()
const runId = route.params.id

const { data: testRun, refresh } = await useFetch(`/api/test-runs/${runId}`)

const columns = [{
  key: 'id',
  label: 'Test ID'
}, {
  key: 'title',
  label: 'Test Title'
}, {
  key: 'status',
  label: 'Status'
}, {
  key: 'duration',
  label: 'Duration'
}, {
  key: 'retries',
  label: 'Retries'
}, {
  key: 'actions',
  label: 'Actions'
}]

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
              <p class="text-sm text-gray-500 mb-2">Report Path</p>
              <code class="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded">{{ testRun.reportPath }}</code>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h3 class="text-lg font-medium">Test Cases</h3>
          </template>

          <UTable :columns="columns" :rows="testRun?.testCases || []">
            <template #id-data="{ row }">
              <NuxtLink :to="`/test-cases/${row.id}`" class="text-primary hover:underline">
                #{{ row.id }}
              </NuxtLink>
            </template>

            <template #title-data="{ row }">
              <div>
                <div class="font-medium">{{ row.title }}</div>
                <div v-if="row.location" class="text-xs text-gray-500">{{ row.location }}</div>
              </div>
            </template>

            <template #status-data="{ row }">
              <UBadge :color="getStatusColor(row.status)">
                {{ row.status }}
              </UBadge>
            </template>

            <template #duration-data="{ row }">
              {{ formatDuration(row.duration) }}
            </template>

            <template #retries-data="{ row }">
              {{ row.retries }}
            </template>

            <template #actions-data="{ row }">
              <UButton :to="`/test-cases/${row.id}`" size="xs" variant="outline">
                View Details
              </UButton>
            </template>
          </UTable>

          <div v-if="!testRun?.testCases || testRun.testCases.length === 0" class="text-center py-8 text-gray-500">
            No test cases recorded for this run.
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
