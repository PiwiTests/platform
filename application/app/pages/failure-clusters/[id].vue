<script setup lang="ts">
import type { FailureClusterDetail } from '~~/types/api'
import { formatRelativeTime } from '~/utils'

const route = useRoute()
const clusterId = parseInt(String(route.params.id))

const { data: cluster, refresh } = await useFetch<FailureClusterDetail>(`/api/failure-clusters/${clusterId}`)

useHead(computed(() => ({ title: `${cluster.value?.signature ?? 'Failure cluster'} — Piwi Dashboard` })))

const activeTab = ref('details')

const tabItems = computed(() => [
  {
    label: `Details (${cluster.value?.affectedTests ?? 0} tests)`,
    icon: 'i-lucide-alert-circle',
    value: 'details',
    slot: 'details'
  },
  { label: 'Triage', icon: 'i-lucide-tag', value: 'triage', slot: 'triage' },
  { label: 'AI Diagnosis', icon: 'i-lucide-sparkles', value: 'diagnosis', slot: 'diagnosis' }
])

const statusColors: Record<string, 'success' | 'warning' | 'neutral' | 'error'> = {
  open: 'warning',
  resolved: 'success',
  ignored: 'neutral'
}

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
  <UDashboardPanel>
    <UDashboardNavbar title="Failure cluster">
      <template #leading>
        <UButton
          v-if="cluster?.project"
          icon="i-lucide-arrow-left"
          color="neutral"
          variant="ghost"
          :to="`/projects/${cluster.project.id}?tab=failure-clusters`"
        >
          {{ cluster.project.label || cluster.project.name }}
        </UButton>
      </template>
    </UDashboardNavbar>

    <div v-if="cluster" class="h-full overflow-y-auto flex flex-col">
      <!-- Summary -->
      <div class="px-6 pt-5 pb-4 border-b border-default space-y-2.5 shrink-0">
        <p class="font-mono text-sm break-all text-gray-800 dark:text-gray-200">
          {{ cluster.signature }}
        </p>
        <div class="flex flex-wrap gap-2">
          <UBadge :color="statusColors[cluster.status] || 'neutral'" variant="subtle">
            {{ cluster.status }}
          </UBadge>
          <UBadge
            v-if="cluster.errorType"
            :color="errorTypeColors[cluster.errorType] || 'neutral'"
            variant="subtle"
          >
            {{ cluster.errorType }}
          </UBadge>
          <UBadge color="neutral" variant="subtle">
            {{ cluster.occurrences }} occurrence{{ cluster.occurrences === 1 ? '' : 's' }}
          </UBadge>
          <UBadge color="neutral" variant="subtle">
            {{ cluster.affectedTests }} {{ cluster.affectedTests === 1 ? 'test' : 'tests' }} affected
          </UBadge>
          <UBadge
            v-if="cluster.diagnosis?.status === 'completed' && cluster.diagnosis?.category"
            color="neutral"
            variant="outline"
            class="gap-1"
          >
            <UIcon name="i-lucide-sparkles" class="size-3" />
            {{ cluster.diagnosis.category }}
          </UBadge>
        </div>
        <p class="text-sm text-gray-500">
          First seen in
          <NuxtLink :to="`/test-runs/${cluster.firstSeenRunId}`" class="text-primary hover:underline">
            run #{{ cluster.firstSeenRunId }}
          </NuxtLink>
          · Last seen in
          <NuxtLink :to="`/test-runs/${cluster.lastSeenRunId}`" class="text-primary hover:underline">
            run #{{ cluster.lastSeenRunId }}
          </NuxtLink>
          <template v-if="cluster.lastSeenAt">
            ({{ formatRelativeTime(cluster.lastSeenAt) }})
          </template>
        </p>
      </div>

      <!-- Tabs -->
      <UTabs
        v-model="activeTab"
        :items="tabItems"
        size="sm"
        class="shrink-0 px-6"
      >
        <template #details>
          <ClusterDetailsTab
            :sample-error="cluster.sampleError"
            :affected-test-cases="cluster.affectedTestCases"
          />
        </template>

        <template #triage>
          <ClusterTriageTab
            :cluster-id="clusterId"
            :initial-status="cluster.status"
            :initial-note="cluster.triageNote || ''"
            @saved="refresh()"
          />
        </template>

        <template #diagnosis>
          <div class="pt-4">
            <ClusterDiagnosis :cluster-id="clusterId" />
          </div>
        </template>
      </UTabs>
    </div>

    <div v-else class="flex items-center justify-center h-64 text-gray-500">
      Cluster not found.
    </div>
  </UDashboardPanel>
</template>
