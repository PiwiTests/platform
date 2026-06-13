<script setup lang="ts">
import type { FlakyTest } from '~~/types/api'
import { formatRelativeTime } from '~/utils'

const props = defineProps<{
  projectId: string | number
}>()

const runsWindow = ref(50)

const { data: tests, pending: loading } = await useFetch<FlakyTest[]>(
  () => `/api/projects/${props.projectId}/flaky-tests?runs=${runsWindow.value}`,
  { lazy: true, server: false, watch: [runsWindow] }
)

function scoreColor(score: number): 'error' | 'warning' | 'neutral' {
  if (score >= 60) return 'error'
  if (score >= 30) return 'warning'
  return 'neutral'
}
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <div>
          <h3 class="font-semibold">
            Flaky Tests
          </h3>
          <p class="text-sm text-gray-500 mt-1">
            Tests that fail intermittently — detected by retry passes and status alternations
          </p>
        </div>
        <USelect
          v-model="runsWindow"
          :items="[
            { label: 'Last 20 runs', value: 20 },
            { label: 'Last 50 runs', value: 50 },
            { label: 'Last 100 runs', value: 100 }
          ]"
          size="xs"
          class="w-36"
        />
      </div>
    </template>

    <div v-if="loading" class="flex items-center justify-center py-8 text-gray-500 gap-2">
      <UIcon name="i-lucide-loader-2" class="size-4 animate-spin" />
      <span>Analyzing flaky tests...</span>
    </div>

    <div v-else-if="tests && tests.length > 0" class="divide-y divide-default">
      <div
        v-for="test in tests"
        :key="test.testCaseId"
        class="py-3 flex flex-col sm:flex-row sm:items-center gap-2"
      >
        <div class="min-w-0 flex-1 space-y-1">
          <div class="flex items-center gap-2">
            <NuxtLink
              :to="`/test-cases/${test.latestRunsCaseId}`"
              class="text-sm font-medium hover:text-primary hover:underline truncate"
              :title="test.title"
            >
              {{ test.title }}
            </NuxtLink>
          </div>
          <div class="text-xs text-gray-400 truncate">
            {{ test.filePath }}
          </div>
          <div class="flex flex-wrap items-center gap-1.5">
            <UBadge :color="scoreColor(test.score)" variant="subtle" size="sm">
              Score {{ test.score }}
            </UBadge>
            <UBadge
              v-if="test.retryPassRuns > 0"
              color="warning"
              variant="outline"
              size="sm"
            >
              Passed on retry in {{ test.retryPassRuns }} run{{ test.retryPassRuns === 1 ? '' : 's' }}
            </UBadge>
            <UBadge
              v-if="test.alternations >= 2"
              color="neutral"
              variant="outline"
              size="sm"
            >
              {{ test.alternations }} status flip{{ test.alternations === 1 ? '' : 's' }}
            </UBadge>
            <UBadge color="neutral" variant="subtle" size="sm">
              {{ Math.round(test.failureRate * 100) }}% failure rate
            </UBadge>
            <span v-if="test.lastFlakeAt" class="text-xs text-gray-500">
              Last flake {{ formatRelativeTime(test.lastFlakeAt) }}
            </span>
          </div>
        </div>
      </div>
    </div>

    <p v-else class="text-sm text-gray-500 py-4">
      No flaky tests detected in the last {{ runsWindow }} runs.
    </p>
  </UCard>
</template>
