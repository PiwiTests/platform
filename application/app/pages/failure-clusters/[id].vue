<script setup lang="ts">
import type { FailureClusterDetail } from '~~/types/api'
import { formatRelativeTime } from '~/utils'

const route = useRoute()
const clusterId = parseInt(String(route.params.id))

const { data: cluster, refresh } = await useFetch<FailureClusterDetail>(`/api/failure-clusters/${clusterId}`)

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

// Triage
const triageStatus = ref('')
const triageNote = ref('')
const savingTriage = ref(false)

watch(cluster, (val) => {
  if (!val) return
  triageStatus.value = val.status
  triageNote.value = val.triageNote || ''
}, { immediate: true })

const triageOptions = [
  { label: 'Open', value: 'open' },
  { label: 'Resolved', value: 'resolved' },
  { label: 'Ignored', value: 'ignored' }
]

async function saveTriage() {
  if (!cluster.value) return
  savingTriage.value = true
  try {
    await $fetch(`/api/failure-clusters/${clusterId}/status`, {
      method: 'PATCH',
      body: { status: triageStatus.value, triageNote: triageNote.value.trim() || null }
    })
    await refresh()
  } finally {
    savingTriage.value = false
  }
}

const triageChanged = computed(() =>
  cluster.value && (triageStatus.value !== cluster.value.status || triageNote.value.trim() !== (cluster.value.triageNote || ''))
)
</script>

<template>
  <UDashboardPanel>
    <UDashboardNavbar :title="cluster?.signature ?? 'Failure Cluster'">
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

    <div v-if="cluster" class="h-full overflow-y-auto">
      <div class="max-w-4xl mx-auto p-6 space-y-6">
        <!-- Cluster header -->
        <UCard>
          <div class="space-y-3">
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
            <pre
              v-if="cluster.sampleError"
              class="text-xs font-mono bg-muted rounded p-3 overflow-x-auto max-h-48 whitespace-pre-wrap"
            >{{ cluster.sampleError }}</pre>
          </div>
        </UCard>

        <!-- Triage -->
        <UCard>
          <template #header>
            <h3 class="font-semibold">
              Triage
            </h3>
          </template>
          <div class="space-y-4">
            <URadioGroup
              v-model="triageStatus"
              :items="triageOptions"
            />
            <UFormField label="Note" description="Optional context about this cluster's resolution or workaround">
              <UTextarea
                v-model="triageNote"
                placeholder="e.g. Known issue tracked in JIRA-1234, fixed in next release…"
                :rows="3"
                class="w-full"
              />
            </UFormField>
          </div>
          <template #footer>
            <UButton
              :loading="savingTriage"
              :disabled="!triageChanged"
              icon="i-lucide-check"
              @click="saveTriage"
            >
              Save triage
            </UButton>
          </template>
        </UCard>

        <!-- AI Diagnosis -->
        <UCard>
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-sparkles" class="size-4 text-primary" />
              <h3 class="font-semibold">
                AI Diagnosis
              </h3>
            </div>
          </template>
          <ClusterDiagnosis :cluster-id="clusterId" :show-context-preview="true" />
        </UCard>

        <!-- Affected test cases -->
        <UCard v-if="cluster.affectedTestCases?.length">
          <template #header>
            <h3 class="font-semibold">
              Affected test cases
            </h3>
          </template>
          <div class="divide-y divide-default">
            <div
              v-for="tc in cluster.affectedTestCases"
              :key="tc.testCaseId"
              class="py-2.5 flex items-center justify-between gap-4"
            >
              <div class="min-w-0">
                <p class="text-sm font-medium truncate">
                  {{ tc.title }}
                </p>
                <p class="text-xs text-gray-500 font-mono truncate">
                  {{ tc.filePath }}
                </p>
              </div>
              <UBadge
                color="neutral"
                variant="outline"
                size="sm"
                class="shrink-0"
              >
                {{ tc.runCount }}×
              </UBadge>
            </div>
          </div>
        </UCard>
      </div>
    </div>

    <div v-else class="flex items-center justify-center h-64 text-gray-500">
      Cluster not found.
    </div>
  </UDashboardPanel>
</template>
