<script setup lang="ts">
import type { ProjectFailureCluster } from '~~/types/api'

const props = defineProps<{
  projectId: string | number
}>()

const { data: clusters, pending: loading } = await useFetch<ProjectFailureCluster[]>(
  `/api/projects/${props.projectId}/failure-clusters`,
  { lazy: true, server: false }
)

const errorTypeColors: Record<string, 'error' | 'warning' | 'info' | 'neutral' | 'secondary'> = {
  'timeout': 'warning',
  'assertion': 'error',
  'strict-mode': 'info',
  'navigation': 'secondary',
  'crash': 'error',
  'unknown': 'neutral'
}
</script>

<template>
  <UCard v-if="loading">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
        <h2>Loading failure clusters...</h2>
      </div>
    </template>
  </UCard>

  <UCard v-else-if="!clusters || clusters.length === 0">
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-check-circle" class="size-5 text-green-500" />
        <h2>Failure clusters</h2>
      </div>
    </template>
    <p class="text-sm text-gray-500">
      No failure clusters recorded for this project.
    </p>
  </UCard>

  <UCard v-else>
    <template #header>
      <div class="flex items-center gap-2">
        <UIcon name="i-lucide-layers" class="size-5 text-primary" />
        <h2>Failure clusters ({{ clusters.length }})</h2>
      </div>
      <p class="text-sm text-gray-500 mt-1">
        Ongoing failure signatures grouped by normalized error. Each cluster represents a distinct root cause.
      </p>
    </template>

    <div class="divide-y divide-default">
      <div
        v-for="cluster in clusters"
        :key="cluster.id"
        class="py-3 flex flex-col sm:flex-row sm:items-center gap-2"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <div class="font-mono text-sm truncate" :title="cluster.signature">
            {{ cluster.signature }}
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <UBadge
              v-if="cluster.errorType"
              :color="errorTypeColors[cluster.errorType] || 'neutral'"
              variant="subtle"
              size="sm"
            >
              {{ cluster.errorType }}
            </UBadge>
            <UBadge color="neutral" variant="subtle" size="sm">
              {{ cluster.affectedTests }} {{ cluster.affectedTests === 1 ? 'test' : 'tests' }} affected
            </UBadge>
            <UBadge color="neutral" variant="outline" size="sm">
              {{ cluster.occurrences }} occurrence{{ cluster.occurrences === 1 ? '' : 's' }}
            </UBadge>
            <span class="text-xs text-gray-500">
              Last seen in
              <NuxtLink
                :to="`/test-runs/${cluster.lastSeenRunId}`"
                class="text-primary hover:underline"
              >run #{{ cluster.lastSeenRunId }}</NuxtLink>
              <template v-if="cluster.lastSeenAt"> ({{ formatRelativeTime(cluster.lastSeenAt) }})</template>
            </span>
          </div>
        </div>
        <NuxtLink
          :to="`/test-runs/${cluster.lastSeenRunId}`"
          class="shrink-0"
        >
          <UButton size="xs" color="neutral" variant="outline">
            View run
          </UButton>
        </NuxtLink>
      </div>
    </div>
  </UCard>
</template>
