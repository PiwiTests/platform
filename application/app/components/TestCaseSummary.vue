<script setup lang="ts">
import type { TestCaseResult } from '~~/types/api'

interface ScmInfo {
  commit?: string
  branch?: string
  author?: string
  commitMessage?: string
}

interface CiInfo {
  provider?: string
  buildNumber?: string
  buildUrl?: string
  workflow?: string
}

interface BrowserInfo {
  browserName?: string | null
  viewport?: { width?: number, height?: number } | null
}

interface HistoricalTiming {
  avg: number
  current: number
  diff: number
  pct: number
}

defineProps<{
  testCase: TestCaseResult | null
  scmInfo: ScmInfo | null
  ciInfo: CiInfo | null
  browserInfo: BrowserInfo | null
  environment: string | null | undefined
  reportPath: string | null
  stepsCount: number
  historicalTiming: HistoricalTiming | null
  summaryColSpanClass: string
  blockColSpanClass: string
}>()

defineEmits<{
  refresh: []
}>()
</script>

<template>
  <div class="grid grid-cols-1 lg:grid-cols-12 gap-4">
    <!-- Main summary card -->
    <div :class="summaryColSpanClass">
      <UCard class="shadow-xs h-full">
        <div class="space-y-3">
          <div class="flex items-start gap-3">
            <div
              class="shrink-0 size-8 rounded-lg flex items-center justify-center"
              :class="{
                'bg-green-100 text-green-700 dark:bg-green-900/40 dark:text-green-400': testCase?.status === 'passed',
                'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-400': testCase?.status === 'failed' || testCase?.status === 'timedOut',
                'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400': testCase?.status === 'cancelled' || testCase?.status === 'skipped',
                'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400': testCase?.status === 'running' || testCase?.status === 'initialising'
              }"
            >
              <UIcon
                :name="testCase?.status === 'passed' ? 'i-lucide-check-circle-2'
                  : testCase?.status === 'failed' || testCase?.status === 'timedOut' ? 'i-lucide-x-circle'
                    : testCase?.status === 'running' || testCase?.status === 'initialising' ? 'i-lucide-loader-circle'
                      : 'i-lucide-minus-circle'"
                class="size-4.5"
                :class="{ 'animate-spin': testCase?.status === 'running' || testCase?.status === 'initialising' }"
              />
            </div>
            <div class="min-w-0 flex-1">
              <div class="flex items-center gap-2 flex-wrap">
                <h2 class="text-base font-bold truncate">
                  {{ testCase?.title }}
                </h2>
                <UBadge v-if="testCase" :color="getStatusColor(testCase.status)" class="capitalize">
                  {{ testCase.status }}
                </UBadge>
              </div>
              <p class="text-xs text-gray-500 mt-0.5">
                <span v-if="testCase?.location">{{ testCase.location }}</span>
                <span v-if="historicalTiming" class="ml-2">
                  Avg {{ formatDuration(historicalTiming.avg) }} &middot;
                  <span :class="historicalTiming.diff > 0 ? 'text-red-600' : 'text-green-600'">
                    {{ historicalTiming.diff > 0 ? '+' : '' }}{{ historicalTiming.pct }}%
                  </span>
                </span>
              </p>
            </div>
          </div>

          <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
              <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Duration
              </p>
              <p class="text-xl font-bold mt-0.5">
                {{ formatDuration(testCase?.duration) }}
              </p>
            </div>
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
              <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Retries
              </p>
              <p class="text-xl font-bold mt-0.5">
                {{ testCase?.retries ?? 0 }}
              </p>
            </div>
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
              <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Steps
              </p>
              <p class="text-xl font-bold mt-0.5">
                {{ stepsCount }}
              </p>
            </div>
            <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-3">
              <p class="text-xs font-medium text-gray-500 uppercase tracking-wider">
                Worker
              </p>
              <p class="text-xl font-bold mt-0.5">
                {{ testCase?.workerIndex ?? '—' }}
              </p>
            </div>
          </div>

          <div v-if="testCase?.slowestStep" class="flex items-center gap-2 text-sm">
            <UIcon name="i-lucide-zap" class="size-4 text-amber-500 shrink-0" />
            <span class="font-medium text-amber-700 dark:text-amber-300">Slowest step:</span>
            <span class="text-gray-700 dark:text-gray-300 truncate">{{ testCase.slowestStep }}</span>
            <span v-if="testCase.slowestStepDuration" class="text-gray-500 shrink-0">({{ formatDuration(testCase.slowestStepDuration) }})</span>
          </div>
        </div>
      </UCard>
    </div>

    <!-- Source -->
    <SourceInfoCard v-if="scmInfo" :scm="scmInfo" :class="blockColSpanClass" />

    <!-- CI / Env -->
    <CiEnvCard
      v-if="ciInfo || environment"
      :ci="ciInfo"
      :environment="environment"
      :class="blockColSpanClass"
    />

    <!-- Browser -->
    <UCard v-if="browserInfo" :class="blockColSpanClass">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-globe" class="w-4 h-4 text-primary" />
          <span class="text-sm font-medium">Browser</span>
        </div>
      </template>
      <div class="space-y-2 text-sm">
        <div class="flex items-center gap-1.5">
          <UIcon name="i-lucide-chrome" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span class="capitalize">{{ browserInfo?.browserName || 'Unknown' }}</span>
        </div>
        <div v-if="browserInfo?.viewport" class="flex items-center gap-1.5">
          <UIcon name="i-lucide-maximize-2" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
          <span class="text-gray-600 dark:text-gray-400">{{ browserInfo.viewport.width }} × {{ browserInfo.viewport.height }}</span>
        </div>
      </div>
    </UCard>

    <!-- Attachments -->
    <UCard v-if="reportPath" :class="blockColSpanClass">
      <template #header>
        <div class="flex items-center gap-2">
          <UIcon name="i-lucide-paperclip" class="w-4 h-4 text-primary" />
          <span class="text-sm font-medium">Attachments</span>
        </div>
      </template>
      <div class="space-y-2 text-sm">
        <UButton
          :to="reportPath"
          target="_blank"
          icon="i-lucide-external-link"
          label="Open in HTML report"
          color="primary"
          variant="outline"
          size="sm"
          class="w-full"
        />
      </div>
    </UCard>
  </div>
</template>
