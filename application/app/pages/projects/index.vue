<script setup lang="ts">
const { data: projects, refresh } = await useFetch('/api/projects')

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

          <div v-if="projects && projects.length > 0" class="divide-y divide-gray-200 dark:divide-gray-800">
            <div v-for="project in projects" :key="project.id" class="py-4 flex items-center justify-between hover:bg-gray-50 dark:hover:bg-gray-800/50 px-4 rounded">
              <div class="flex-1">
                <NuxtLink :to="`/projects/${project.id}`" class="text-primary hover:underline font-medium text-lg">
                  {{ project.name }}
                </NuxtLink>
                <div class="mt-1 flex gap-4 text-sm text-gray-600 dark:text-gray-400">
                  <span>{{ project.totalRuns }} test runs</span>
                  <span v-if="project.latestRun">Last run: {{ formatDate(project.latestRun.startTime) }}</span>
                </div>
              </div>
              <div class="flex items-center gap-3">
                <UBadge v-if="project.latestRun" :color="getStatusColor(project.latestRun.status)" size="md">
                  {{ project.latestRun.status }}
                </UBadge>
                <UButton :to="`/projects/${project.id}`" size="sm" variant="outline">
                  View Details
                </UButton>
              </div>
            </div>
          </div>

          <div v-else class="text-center py-12 text-gray-500">
            <p class="text-lg mb-2">No projects yet</p>
            <p class="text-sm">Submit test results via the API to create projects</p>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
