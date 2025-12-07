<script setup lang="ts">
const route = useRoute()
const projectId = route.params.id

const { data: project, refresh } = await useFetch(`/api/projects/${projectId}`)

const columns = [{
  key: 'id',
  label: 'Run ID'
}, {
  key: 'status',
  label: 'Status'
}, {
  key: 'startTime',
  label: 'Start Time'
}, {
  key: 'duration',
  label: 'Duration'
}, {
  key: 'totalTests',
  label: 'Total'
}, {
  key: 'passedTests',
  label: 'Passed'
}, {
  key: 'failedTests',
  label: 'Failed'
}, {
  key: 'actions',
  label: 'Actions'
}]

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
          <UButton icon="i-lucide-refresh-cw" size="md" @click="() => refresh()" label="Refresh" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-4">
        <UButton to="/projects" icon="i-lucide-arrow-left" variant="ghost" size="sm">
          Back to Projects
        </UButton>

        <UCard>
          <template #header>
            <div class="flex justify-between items-center">
              <h2 class="text-xl font-semibold">{{ project?.name }}</h2>
            </div>
            <p v-if="project?.description" class="text-gray-600 mt-2">{{ project.description }}</p>
          </template>

          <div class="space-y-4">
            <div>
              <h3 class="text-lg font-medium mb-3">Test Runs</h3>
              <UTable :columns="columns" :rows="project?.testRuns || []">
                <template #id-data="{ row }">
                  <NuxtLink :to="`/test-runs/${row.id}`" class="text-primary hover:underline">
                    #{{ row.id }}
                  </NuxtLink>
                </template>

                <template #status-data="{ row }">
                  <UBadge :color="getStatusColor(row.status)">
                    {{ row.status }}
                  </UBadge>
                </template>

                <template #startTime-data="{ row }">
                  {{ formatDate(row.startTime) }}
                </template>

                <template #duration-data="{ row }">
                  {{ formatDuration(row.duration) }}
                </template>

                <template #totalTests-data="{ row }">
                  {{ row.totalTests }}
                </template>

                <template #passedTests-data="{ row }">
                  <span class="text-green-600">{{ row.passedTests }}</span>
                </template>

                <template #failedTests-data="{ row }">
                  <span class="text-red-600">{{ row.failedTests }}</span>
                </template>

                <template #actions-data="{ row }">
                  <UButton :to="`/test-runs/${row.id}`" size="xs" variant="outline">
                    View Details
                  </UButton>
                </template>
              </UTable>

              <div v-if="!project?.testRuns || project.testRuns.length === 0" class="text-center py-8 text-gray-500">
                No test runs yet for this project.
              </div>
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
