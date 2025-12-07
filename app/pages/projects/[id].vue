<template>
  <div class="min-h-screen bg-gray-50">
    <div class="container mx-auto p-6">
      <div class="mb-6">
        <UButton 
          variant="ghost" 
          icon="i-heroicons-arrow-left"
          @click="navigateTo('/')"
        >
          Back to Projects
        </UButton>
      </div>

      <div v-if="pending" class="text-center py-12">
        <p class="text-gray-500">Loading project...</p>
      </div>

      <div v-else-if="project">
        <div class="mb-8">
          <h1 class="text-4xl font-bold text-gray-900">{{ project.name }}</h1>
          <p v-if="project.description" class="text-gray-600 mt-2">{{ project.description }}</p>
        </div>

        <div class="mb-6">
          <h2 class="text-2xl font-semibold mb-4">Test Runs</h2>
        </div>

        <div v-if="runsPending" class="text-center py-8">
          <p class="text-gray-500">Loading test runs...</p>
        </div>

        <div v-else-if="runs?.length === 0" class="text-center py-12 bg-white rounded-lg border">
          <p class="text-gray-500 mb-2">No test runs yet</p>
          <p class="text-sm text-gray-400">Use the API to submit test results</p>
        </div>

        <div v-else class="space-y-4">
          <UCard 
            v-for="run in runs" 
            :key="run.id"
            class="hover:shadow-md transition-shadow"
          >
            <div class="flex items-center justify-between">
              <div class="flex-1">
                <div class="flex items-center gap-3">
                  <UBadge 
                    :color="getStatusColor(run.status)"
                    variant="subtle"
                    size="lg"
                  >
                    {{ run.status }}
                  </UBadge>
                  <span class="font-mono text-sm text-gray-600">{{ run.id }}</span>
                </div>
                
                <div class="mt-3 grid grid-cols-2 md:grid-cols-5 gap-4 text-sm">
                  <div>
                    <span class="text-gray-500">Total:</span>
                    <span class="ml-1 font-semibold">{{ run.totalTests }}</span>
                  </div>
                  <div>
                    <span class="text-green-600">Passed:</span>
                    <span class="ml-1 font-semibold">{{ run.passed }}</span>
                  </div>
                  <div>
                    <span class="text-red-600">Failed:</span>
                    <span class="ml-1 font-semibold">{{ run.failed }}</span>
                  </div>
                  <div>
                    <span class="text-gray-500">Skipped:</span>
                    <span class="ml-1 font-semibold">{{ run.skipped }}</span>
                  </div>
                  <div v-if="run.duration">
                    <span class="text-gray-500">Duration:</span>
                    <span class="ml-1 font-semibold">{{ formatDuration(run.duration) }}</span>
                  </div>
                </div>
              </div>
              
              <div class="text-right text-sm text-gray-500">
                {{ formatDate(run.startTime) }}
              </div>
            </div>
          </UCard>
        </div>
      </div>

      <div v-else class="text-center py-12">
        <p class="text-red-500">Project not found</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import type { Project, TestRun } from '~/types'

const route = useRoute()
const projectId = route.params.id as string

const { data: project, pending } = await useFetch<Project>(`/api/projects/${projectId}`)
const { data: runs, pending: runsPending } = await useFetch<TestRun[]>(`/api/projects/${projectId}/runs`)

const getStatusColor = (status: string) => {
  const colors: Record<string, string> = {
    passed: 'green',
    failed: 'red',
    running: 'blue',
    timedOut: 'orange'
  }
  return colors[status] || 'gray'
}

const formatDate = (date: string) => {
  return new Date(date).toLocaleString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

const formatDuration = (ms: number) => {
  const seconds = Math.floor(ms / 1000)
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  
  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`
  }
  return `${seconds}s`
}
</script>
