<script setup lang="ts">
import type { TestRunDetails, ReportInfo } from '~~/types/api'

const props = defineProps<{
  testRun: TestRunDetails
  displayProgress: { totalTests: number, passedTests: number, failedTests: number, skippedTests: number } | null
  allReports: ReportInfo[]
  showCustomData: boolean
  summaryColSpanClass: string
  blockColSpanClass: string
}>()

const emit = defineEmits<{
  'update:showCustomData': [value: boolean]
}>()

const storageStats = computed(() => props.testRun?.storageStats)
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-8 gap-4">
    <div :class="summaryColSpanClass">
      <UCard class="shadow-xs h-full">
        <div class="space-y-3">
          <div class="flex items-start justify-between gap-3">
            <div class="flex items-center gap-2.5 min-w-0">
              <div
                class="shrink-0 size-8 rounded-lg flex items-center justify-center"
                :class="{
                  'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400': testRun?.status === 'passed',
                  'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400': testRun?.status === 'failed' || testRun?.status === 'timedOut',
                  'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400': testRun?.status === 'cancelled' || testRun?.status === 'skipped',
                  'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400': testRun?.status === 'running' || testRun?.status === 'initialising'
                }"
              >
                <UIcon
                  :name="testRun?.status === 'passed' ? 'i-lucide-check-circle-2'
                    : testRun?.status === 'failed' || testRun?.status === 'timedOut' ? 'i-lucide-x-circle'
                      : testRun?.status === 'running' || testRun?.status === 'initialising' ? 'i-lucide-loader-circle'
                        : 'i-lucide-minus-circle'"
                  class="size-4.5"
                  :class="{ 'animate-spin': testRun?.status === 'running' || testRun?.status === 'initialising' }"
                />
              </div>
              <div class="min-w-0">
                <div class="flex items-center gap-2 flex-wrap">
                  <h2 class="text-base font-bold truncate">
                    Test run #{{ testRun?.id }}
                  </h2>
                  <RunStatusBadge :status="testRun?.status ?? ''" />
                </div>
                <p class="text-xs text-gray-500 mt-0.5">
                  {{ testRun?.project?.label ?? testRun?.project?.name }}
                  &middot; Started {{ prettyDateFormat(testRun?.startTime) }}
                </p>
              </div>
            </div>
            <div v-if="allReports.length > 0" class="shrink-0 hidden sm:flex items-start gap-2">
              <RunReports :reports="allReports" />
            </div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
              <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Total
              </p>
              <p class="text-xl font-bold mt-0.5">
                {{ displayProgress?.totalTests ?? testRun?.totalTests ?? 0 }}
              </p>
            </div>
            <div class="rounded-lg bg-green-50 dark:bg-green-900/20 p-3">
              <p class="text-xs font-medium text-green-700 dark:text-green-400 uppercase tracking-wider">
                <span class="inline-block size-1.5 rounded-full bg-green-500 mr-1 align-middle" /> Passed
              </p>
              <p class="text-xl font-bold mt-0.5 text-green-600 dark:text-green-400">
                {{ displayProgress?.passedTests ?? testRun?.passedTests ?? 0 }}
              </p>
            </div>
            <div class="rounded-lg bg-red-50 dark:bg-red-900/20 p-3">
              <p class="text-xs font-medium text-red-700 dark:text-red-400 uppercase tracking-wider">
                <span class="inline-block size-1.5 rounded-full bg-red-500 mr-1 align-middle" /> Failed
              </p>
              <p class="text-xl font-bold mt-0.5 text-red-600 dark:text-red-400">
                {{ displayProgress?.failedTests ?? testRun?.failedTests ?? 0 }}
              </p>
            </div>
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
              <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">
                <span class="inline-block size-1.5 rounded-full bg-gray-400 mr-1 align-middle" /> Skipped
              </p>
              <p class="text-xl font-bold mt-0.5 text-gray-600 dark:text-gray-400">
                {{ displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0 }}
              </p>
            </div>
          </div>

          <div>
            <div v-if="testRun" class="flex items-center gap-3">
              <div class="flex-1 max-w-md">
                <TestStatusBar
                  :passed="displayProgress?.passedTests ?? testRun?.passedTests ?? 0"
                  :failed="displayProgress?.failedTests ?? testRun?.failedTests ?? 0"
                  :skipped="displayProgress?.skippedTests ?? testRun?.skippedTests ?? 0"
                  :flaky="testRun?.flakyTests ?? 0"
                  :total="displayProgress?.totalTests ?? testRun?.totalTests ?? 0"
                />
              </div>
              <div class="flex items-center gap-3 text-xs shrink-0">
                <div class="flex items-center gap-1">
                  <UIcon name="i-lucide-clock" class="size-3.5 text-gray-400" />
                  <span class="font-medium tabular-nums">{{ formatDuration(testRun?.duration) }}</span>
                </div>
                <div v-if="testRun?.avgTestDuration" class="flex items-center gap-1">
                  <UIcon name="i-lucide-gauge" class="size-3.5 text-gray-400" />
                  <span class="text-gray-500 hidden sm:inline">Avg</span>
                  <span class="font-medium tabular-nums">{{ formatDuration(testRun.avgTestDuration) }}</span>
                </div>
                <div v-if="testRun?.p90TestDuration" class="flex items-center gap-1">
                  <UIcon name="i-lucide-arrow-up-right" class="size-3.5 text-orange-500" />
                  <span class="text-gray-500 hidden sm:inline">P90</span>
                  <span class="font-medium tabular-nums text-orange-600 dark:text-orange-400">{{ formatDuration(testRun.p90TestDuration) }}</span>
                </div>
              </div>
            </div>
          </div>

          <div v-if="allReports.length > 0" class="sm:hidden">
            <p class="text-xs font-medium text-gray-500 uppercase tracking-wider mb-1">
              Reports
            </p>
            <RunReports :reports="allReports" />
          </div>
        </div>
      </UCard>
    </div>

    <!-- Block 1: CI + Environment -->
    <CiEnvCard
      v-if="testRun?.metadata?.ci || testRun?.environment"
      :ci="testRun?.metadata?.ci"
      :environment="testRun?.environment"
      :class="blockColSpanClass"
    />

    <!-- Block 2: Source control + Storage stats -->
    <div v-if="testRun?.metadata?.scm || storageStats" :class="blockColSpanClass">
      <div class="grid grid-cols-2 gap-4">
        <SourceInfoCard
          v-if="testRun?.metadata?.scm"
          :scm="testRun.metadata.scm"
          class="h-full"
        />
        <UCard v-if="storageStats" class="h-full shadow-xs">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-database" class="w-4 h-4 text-primary" />
              <span class="text-sm font-medium">Storage</span>
            </div>
          </template>
          <div class="flex gap-4 text-sm">
            <div>
              <p class="text-muted text-xs">Files</p>
              <p class="font-semibold text-lg">{{ storageStats.totalFiles }}</p>
            </div>
            <div>
              <p class="text-muted text-xs">Total size</p>
              <p class="font-semibold text-lg">{{ formatBytes(storageStats.totalSize) }}</p>
            </div>
          </div>
        </UCard>
      </div>
    </div>

    <!-- Block 4: Tags / Details / Custom data -->
    <UCard v-if="testRun?.metadata?.tags?.length || testRun?.metadata?.projectDescription || testRun?.metadata?.relatedIssue || testRun?.metadata?.customData" :class="blockColSpanClass">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-tags" class="w-4 h-4 text-primary" />
          <span class="text-sm font-medium">Other</span>
        </div>
      </template>
      <div class="space-y-3 text-sm">
        <div v-if="testRun.metadata.tags && testRun.metadata.tags.length > 0">
          <div class="flex flex-wrap gap-1.5">
            <UBadge
              v-for="tag in testRun.metadata.tags"
              :key="tag"
              color="neutral"
              variant="soft"
              size="sm"
            >
              {{ tag }}
            </UBadge>
          </div>
        </div>
        <p v-if="testRun.metadata.projectDescription" class="text-gray-700 dark:text-gray-300">
          {{ testRun.metadata.projectDescription }}
        </p>
        <p v-if="testRun.metadata.relatedIssue" class="flex items-center gap-1">
          <UIcon name="i-lucide-link" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span>{{ testRun.metadata.relatedIssue }}</span>
        </p>
        <UButton
          v-if="testRun.metadata.customData"
          size="xs"
          variant="ghost"
          color="neutral"
          :icon="showCustomData ? 'i-lucide-chevron-up' : 'i-lucide-chevron-down'"
          @click="emit('update:showCustomData', !showCustomData)"
        >
          Custom data
        </UButton>
        <div v-if="showCustomData && testRun.metadata.customData">
          <div class="bg-gray-50 dark:bg-gray-900 p-2.5 rounded text-xs font-mono overflow-x-auto max-h-48 overflow-y-auto">
            <pre class="m-0">{{ JSON.stringify(testRun.metadata.customData, null, 2) }}</pre>
          </div>
        </div>
      </div>
    </UCard>
  </div>
</template>
