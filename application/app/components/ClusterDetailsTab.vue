<script setup lang="ts">
import type { FailureClusterDetail } from '~~/types/api'
import { renderAnsi } from '~/utils'

defineProps<{
  sampleError: string | null
  affectedTestCases: FailureClusterDetail['affectedTestCases']
}>()
</script>

<template>
  <div class="space-y-4 pt-4">
    <UCard v-if="sampleError">
      <template #header>
        <h3 class="font-semibold">
          Error message
        </h3>
      </template>
      <!-- eslint-disable-next-line vue/no-v-html -->
      <div class="text-xs font-mono overflow-x-auto whitespace-pre-wrap" v-html="renderAnsi(sampleError ?? '')" />
    </UCard>

    <UCard v-if="affectedTestCases?.length">
      <template #header>
        <h3 class="font-semibold">
          Affected test cases
        </h3>
      </template>
      <div class="divide-y divide-default">
        <div
          v-for="tc in affectedTestCases"
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

    <p v-if="!sampleError && !affectedTestCases?.length" class="text-sm text-gray-500">
      No details available.
    </p>
  </div>
</template>
