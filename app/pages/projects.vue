<script setup lang="ts">
const { data: projects, refresh } = await useFetch('/api/projects')

const columns = [{
  key: 'name',
  label: 'Project Name'
}, {
  key: 'totalRuns',
  label: 'Total Runs'
}, {
  key: 'latestRun.status',
  label: 'Latest Status'
}, {
  key: 'latestRun.startTime',
  label: 'Last Run'
}, {
  key: 'actions',
  label: 'Actions'
}]

function formatDate(date: string | Date | null) {
  if (!date) return 'N/A'
  return new Date(date).toLocaleString()
}

function getStatusColor(status?: string) {
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
  <UDashboardPanel id="projects">
    <template #header>
      <UDashboardNavbar title="Projects">
        <template #leading>
          <UDashboardSidebarCollapse />
        </template>
        <template #right>
          <UButton icon="i-lucide-refresh-cw" size="md" @click="() => refresh()" label="Refresh" />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4">
        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">Playwright Test Projects</h2>
          </template>

          <UTable :columns="columns" :rows="projects || []">
            <template #name-data="{ row }">
              <NuxtLink :to="`/projects/${row.id}`" class="text-primary hover:underline font-medium">
                {{ row.name }}
              </NuxtLink>
            </template>

            <template #totalRuns-data="{ row }">
              {{ row.totalRuns }}
            </template>

            <template #latestRun.status-data="{ row }">
              <UBadge v-if="row.latestRun" :color="getStatusColor(row.latestRun.status)">
                {{ row.latestRun.status }}
              </UBadge>
              <span v-else class="text-gray-400">No runs</span>
            </template>

            <template #latestRun.startTime-data="{ row }">
              {{ formatDate(row.latestRun?.startTime) }}
            </template>

            <template #actions-data="{ row }">
              <UButton :to="`/projects/${row.id}`" size="xs" variant="outline">
                View Details
              </UButton>
            </template>
          </UTable>

          <div v-if="!projects || projects.length === 0" class="text-center py-8 text-gray-500">
            No projects yet. Submit test results via the API to create projects.
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
