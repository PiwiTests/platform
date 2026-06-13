<script setup lang="ts">
import type { TableColumn } from '@nuxt/ui'
import type { FlakyTest } from '~~/types/api'

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

const columns: TableColumn<FlakyTest>[] = [
  { accessorKey: 'title', header: createSortHeader<FlakyTest>('Test') },
  { accessorKey: 'score', header: createSortHeader<FlakyTest>('Score') },
  { accessorKey: 'failureRate', header: createSortHeader<FlakyTest>('Failure rate') },
  { accessorKey: 'retryPassRuns', header: createSortHeader<FlakyTest>('Retry passes') },
  { accessorKey: 'alternations', header: createSortHeader<FlakyTest>('Flips') },
  { accessorKey: 'lastFlakeAt', header: createSortHeader<FlakyTest>('Last flake') },
  { id: 'actions', header: 'Actions' }
]
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <p class="text-sm text-gray-500">
          Tests that fail intermittently — detected by retry passes and status alternations
        </p>
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

    <UTable :data="tests ?? []" :columns="columns" :loading="loading">
      <template #actions-header>
        <div class="text-right">
          Actions
        </div>
      </template>

      <template #title-cell="{ row }">
        <div class="min-w-0 space-y-0.5">
          <NuxtLink
            :to="`/test-cases/${row.original.latestRunsCaseId}`"
            class="text-sm font-medium text-primary hover:underline truncate block"
            :title="row.original.title"
          >
            {{ row.original.title }}
          </NuxtLink>
          <span class="text-xs text-gray-400 font-mono truncate block">{{ row.original.filePath }}</span>
        </div>
      </template>

      <template #score-cell="{ row }">
        <UBadge :color="scoreColor(row.original.score)" variant="subtle" size="sm">
          {{ row.original.score }}
        </UBadge>
      </template>

      <template #failureRate-cell="{ row }">
        <span class="text-sm tabular-nums">{{ Math.round(row.original.failureRate * 100) }}%</span>
      </template>

      <template #retryPassRuns-cell="{ row }">
        <UBadge
          v-if="row.original.retryPassRuns"
          color="warning"
          variant="outline"
          size="sm"
        >
          {{ row.original.retryPassRuns }} run{{ row.original.retryPassRuns === 1 ? '' : 's' }}
        </UBadge>
        <span v-else class="text-gray-400 text-xs">—</span>
      </template>

      <template #alternations-cell="{ row }">
        <UBadge
          v-if="row.original.alternations >= 2"
          color="neutral"
          variant="outline"
          size="sm"
        >
          {{ row.original.alternations }}
        </UBadge>
        <span v-else class="text-gray-400 text-xs">—</span>
      </template>

      <template #lastFlakeAt-cell="{ row }">
        <span v-if="row.original.lastFlakeAt" class="text-sm text-gray-500">
          {{ formatRelativeTime(row.original.lastFlakeAt) }}
        </span>
        <span v-else class="text-gray-400 text-xs">—</span>
      </template>

      <template #actions-cell="{ row }">
        <div class="flex justify-end">
          <UButton
            :to="`/test-cases/${row.original.latestRunsCaseId}`"
            size="sm"
            variant="outline"
            trailing-icon="i-lucide-arrow-right"
          >
            View
          </UButton>
        </div>
      </template>
    </UTable>

    <p v-if="!loading && tests && tests.length === 0" class="text-sm text-gray-500 py-4 text-center">
      No flaky tests detected in the last {{ runsWindow }} runs.
    </p>
  </UCard>
</template>
