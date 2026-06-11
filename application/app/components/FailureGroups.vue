<script setup lang="ts">
import type { FailureGroup } from '~~/types/api'

const emit = defineEmits<{
  selectTestCase: [id: number]
  selectCluster: [clusterId: number]
}>()

const route = useRoute()
const runId = route.params.id

const { data: groups, pending: loading } = await useFetch<FailureGroup[]>(
  `/api/test-runs/${runId}/failure-groups`,
  { lazy: true, server: false }
)

const expanded = ref<Set<number>>(new Set())

function toggleGroup(clusterId: number) {
  const next = new Set(expanded.value)
  if (next.has(clusterId)) {
    next.delete(clusterId)
  } else {
    next.add(clusterId)
  }
  expanded.value = next
}

// Expand everything by default when the list is small
watch(groups, (val) => {
  if (val && val.length > 0 && val.length <= 3 && expanded.value.size === 0) {
    expanded.value = new Set(val.map(g => g.clusterId))
  }
})

const errorTypeColors: Record<string, 'error' | 'warning' | 'info' | 'neutral' | 'secondary'> = {
  'timeout': 'warning',
  'assertion': 'error',
  'strict-mode': 'info',
  'navigation': 'secondary',
  'crash': 'error',
  'unknown': 'neutral'
}

const statusColors: Record<string, 'success' | 'warning' | 'neutral'> = {
  open: 'warning',
  resolved: 'success',
  ignored: 'neutral'
}
</script>

<template>
  <div class="pt-4">
    <div v-if="loading" class="flex items-center justify-center py-8 text-gray-500 gap-2">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Grouping failures...</span>
    </div>

    <div v-else-if="!groups || groups.length === 0" class="flex flex-col items-center justify-center py-8 text-gray-500 gap-2">
      <UIcon name="i-lucide-party-popper" class="size-6" />
      <span>No failure groups — failed tests without error details are not grouped</span>
    </div>

    <div v-else class="space-y-3">
      <p class="text-sm text-gray-500 dark:text-gray-400">
        {{ groups.reduce((sum, g) => sum + g.caseCount, 0) }} failing
        {{ groups.reduce((sum, g) => sum + g.caseCount, 0) === 1 ? 'test' : 'tests' }} across
        {{ groups.length }} {{ groups.length === 1 ? 'group' : 'groups' }} — each group likely shares one root cause
      </p>

      <UCard v-for="group in groups" :key="group.clusterId" :ui="{ body: 'p-0 sm:p-0' }">
        <button
          type="button"
          class="w-full flex items-start gap-3 p-4 text-left cursor-pointer hover:bg-elevated/50 transition-colors group"
          @click="toggleGroup(group.clusterId)"
        >
          <UIcon
            :name="expanded.has(group.clusterId) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-4 mt-0.5 shrink-0 text-gray-400"
          />
          <div class="min-w-0 flex-1 space-y-1.5">
            <div class="font-mono text-sm truncate" :title="group.signature">
              {{ group.signature }}
            </div>
            <div class="flex flex-wrap items-center gap-1.5">
              <UBadge color="neutral" variant="subtle" size="sm">
                {{ group.caseCount }} {{ group.caseCount === 1 ? 'test' : 'tests' }}
              </UBadge>
              <UBadge
                v-if="group.status"
                :color="statusColors[group.status] || 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ group.status }}
              </UBadge>
              <UBadge
                v-if="group.errorType"
                :color="errorTypeColors[group.errorType] || 'neutral'"
                variant="subtle"
                size="sm"
              >
                {{ group.errorType }}
              </UBadge>
              <UBadge
                v-if="group.isNew"
                color="warning"
                variant="subtle"
                size="sm"
              >
                New in this run
              </UBadge>
              <span v-else class="text-xs text-gray-500 dark:text-gray-400">
                Known since
                <NuxtLink
                  :to="`/test-runs/${group.firstSeenRunId}`"
                  class="text-primary hover:underline"
                  @click.stop
                >run #{{ group.firstSeenRunId }}</NuxtLink>
                <template v-if="group.firstSeenAt"> ({{ formatRelativeTime(group.firstSeenAt) }})</template>
              </span>
              <UBadge
                v-if="group.flaky"
                color="warning"
                variant="outline"
                size="sm"
              >
                Flaky — passed on retry
              </UBadge>
              <UBadge
                v-if="group.workerCorrelated"
                color="info"
                variant="outline"
                size="sm"
                title="All failures in this group ran on the same worker — possibly an infrastructure issue rather than broken tests"
              >
                Same worker
              </UBadge>
              <UButton
                variant="soft"
                color="primary"
                size="xs"
                title="Show only this group in the test cases list"
                @click.stop="emit('selectCluster', group.clusterId)"
              >
                Filter
              </UButton>
            </div>
          </div>
        </button>

        <div v-if="expanded.has(group.clusterId)" class="border-t border-default">
          <div v-if="group.selector" class="px-4 pt-3 text-xs text-gray-500 dark:text-gray-400">
            Locator: <code class="font-mono">{{ group.selector }}</code>
          </div>
          <ul class="divide-y divide-default">
            <li
              v-for="testCase in group.cases"
              :key="testCase.testRunsCaseId"
              class="flex items-center gap-2 px-4 py-2"
            >
              <UIcon name="i-lucide-circle-x" class="size-3.5 shrink-0 text-red-500" />
              <NuxtLink
                :to="`/test-cases/${testCase.testRunsCaseId}`"
                class="text-sm truncate hover:text-primary hover:underline"
                :title="`${testCase.filePath} — ${testCase.title}`"
              >
                {{ testCase.title }}
              </NuxtLink>
              <span class="text-xs text-gray-400 truncate hidden sm:inline">{{ testCase.filePath }}</span>
              <span class="grow" />
              <UBadge
                v-if="testCase.passedOnRetry"
                color="warning"
                variant="subtle"
                size="sm"
              >
                Passed on retry
              </UBadge>
              <UBadge
                v-else-if="testCase.retries > 0"
                color="neutral"
                variant="subtle"
                size="sm"
              >
                {{ testCase.retries }} {{ testCase.retries === 1 ? 'retry' : 'retries' }}
              </UBadge>
              <UButton
                icon="i-lucide-list"
                size="xs"
                color="neutral"
                variant="ghost"
                title="Show in test cases list"
                @click="emit('selectTestCase', testCase.testRunsCaseId)"
              />
            </li>
          </ul>
        </div>
      </UCard>
    </div>
  </div>
</template>
