<script setup lang="ts">
import type { ProjectFailureCluster } from '~~/types/api'

const props = defineProps<{
  projectId: string | number
}>()

const statusFilter = ref<string | undefined>(undefined)
const { data: clusters, pending: loading, refresh } = await useFetch<ProjectFailureCluster[]>(
  () => {
    const params = new URLSearchParams()
    if (statusFilter.value) params.set('status', statusFilter.value)
    const qs = params.toString()
    return `/api/projects/${props.projectId}/failure-clusters${qs ? `?${qs}` : ''}`
  },
  { lazy: true, server: false, watch: [statusFilter] }
)

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

// Triage modal state
const triageCluster = ref<ProjectFailureCluster | null>(null)
const triageNewStatus = ref('open')
const triageNewNote = ref('')
const savingTriage = ref(false)

function openTriage(cluster: ProjectFailureCluster) {
  triageCluster.value = cluster
  triageNewStatus.value = cluster.status
  triageNewNote.value = ''
}

function closeTriage() {
  triageCluster.value = null
  triageNewNote.value = ''
}

async function saveTriage() {
  const cluster = triageCluster.value
  if (!cluster || !triageNewStatus.value || triageNewStatus.value === cluster.status) return

  savingTriage.value = true
  try {
    const res = await $fetch(`/api/failure-clusters/${cluster.id}/status`, {
      method: 'PATCH',
      body: { status: triageNewStatus.value, triageNote: triageNewNote.value?.trim() || null }
    })
    if (res) {
      await refresh()
      closeTriage()
    }
  } catch {
    // silent
  } finally {
    savingTriage.value = false
  }
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
      <div class="flex items-center justify-between">
        <div>
          <div class="flex items-center gap-2">
            <UIcon name="i-lucide-layers" class="size-5 text-primary" />
            <h2>Failure clusters ({{ clusters.length }})</h2>
          </div>
          <p class="text-sm text-gray-500 mt-1">
            Ongoing failure signatures grouped by normalized error. Each cluster represents a distinct root cause.
          </p>
        </div>
        <div class="flex items-center gap-2">
          <USelect
            v-model="statusFilter"
            :options="[
              { label: 'All', value: undefined },
              { label: 'Open', value: 'open' },
              { label: 'Resolved', value: 'resolved' },
              { label: 'Ignored', value: 'ignored' }
            ]"
            size="xs"
            class="w-32"
          />
        </div>
      </div>
    </template>

    <div class="divide-y divide-default">
      <div
        v-for="cluster in clusters"
        :key="cluster.id"
        class="py-3 flex flex-col sm:flex-row sm:items-center gap-2"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <div class="font-mono text-sm truncate flex items-center gap-2" :title="cluster.signature">
            {{ cluster.signature }}
            <UBadge
              :color="statusColors[cluster.status] || 'neutral'"
              variant="subtle"
              size="sm"
            >
              {{ cluster.status }}
            </UBadge>
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
          <div v-if="cluster.triageNote" class="text-xs text-gray-500 italic mt-1">
            {{ cluster.triageNote }}
          </div>
        </div>
        <div class="shrink-0 flex items-center gap-1">
          <UButton
            size="xs"
            color="neutral"
            variant="outline"
            @click="openTriage(cluster)"
          >
            Triage
          </UButton>
          <NuxtLink :to="`/test-runs/${cluster.lastSeenRunId}`">
            <UButton size="xs" color="neutral" variant="outline">
              View run
            </UButton>
          </NuxtLink>
        </div>
      </div>
    </div>
  </UCard>

  <UModal :open="!!triageCluster" title="Triage cluster" @update:open="closeTriage">
    <template #body>
      <div class="flex flex-col gap-4">
        <p class="font-mono text-xs truncate text-gray-500">
          {{ triageCluster?.signature }}
        </p>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium">Status</label>
          <URadioGroup
            v-model="triageNewStatus"
            :items="[
              { label: 'Open', value: 'open' },
              { label: 'Resolved', value: 'resolved' },
              { label: 'Ignored', value: 'ignored' }
            ]"
          />
        </div>
        <div class="flex flex-col gap-1.5">
          <label class="text-sm font-medium">Note</label>
          <UTextarea
            v-model="triageNewNote"
            placeholder="Optional triage note..."
            :maxrows="3"
            size="sm"
          />
        </div>
      </div>
    </template>
    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton
          size="sm"
          color="neutral"
          variant="ghost"
          @click="closeTriage"
        >
          Cancel
        </UButton>
        <UButton
          size="sm"
          color="primary"
          :loading="savingTriage"
          :disabled="!triageNewStatus || triageNewStatus === triageCluster?.status"
          @click="saveTriage"
        >
          Save
        </UButton>
      </div>
    </template>
  </UModal>
</template>
