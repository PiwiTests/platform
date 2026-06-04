<script setup lang="ts">
import type { PerformanceStep, WebVitals, NetworkRequest, TestCaseHistoryPoint, TraceInfo } from '~~/types/api'
import type { TableColumn } from '@nuxt/ui'
import { h, resolveComponent } from 'vue'
import { getPerformanceHints } from '~/utils/performance-hints'
import { generateFixPrompt } from '~/utils/fix-prompt'

const route = useRoute()
const testCaseId = route.params.id

const { data: testCase, refresh } = await useFetch(`/api/test-cases/${testCaseId}`)
const { data: historyData } = await useFetch<TestCaseHistoryPoint[]>(`/api/test-cases/${testCaseId}/history`)
const { data: traceData } = await useFetch<TraceInfo[]>(`/api/test-cases/${testCaseId}/traces`)

useHead(computed(() => ({
  title: `${testCase.value?.title || `Test case #${testCaseId}`} — Piwi Dashboard`
})))

const performanceHints = computed(() => {
  if (!testCase.value) return []
  return getPerformanceHints(testCase.value)
})

const steps = computed(() => {
  if (!testCase.value?.steps) return []
  return testCase.value.steps as PerformanceStep[]
})

const webVitals = computed<WebVitals | null>(() => {
  return (testCase.value?.webVitals as unknown as WebVitals | null) ?? null
})

const networkRequests = computed<NetworkRequest[]>(() => {
  return (testCase.value?.networkRequests as unknown as NetworkRequest[] | null) ?? []
})

function normalizeRoute(url: string): string {
  try {
    const parsed = new URL(url)
    let pathname = parsed.pathname
    pathname = pathname.replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}(?=\/|$)/gi, '/:uuid')
    pathname = pathname.replace(/\/\d+(?=\/|$)/g, '/:id')
    return `${parsed.protocol}//${parsed.host}${pathname}`
  } catch {
    return url
  }
}

interface GroupedRequest {
  key: string
  method: string
  route: string
  count: number
  avgDuration: number
  maxDuration: number
}

const groupedNetworkRequests = computed<GroupedRequest[]>(() => {
  const map = new Map<string, { method: string, route: string, durations: number[] }>()
  for (const req of networkRequests.value) {
    if (req.resourceType && !['fetch', 'xhr', 'document', 'other'].includes(req.resourceType)) continue
    const route = normalizeRoute(req.url)
    const key = `${req.method}|${route}`
    if (!map.has(key)) map.set(key, { method: req.method, route, durations: [] })
    map.get(key)!.durations.push(req.duration)
  }
  return Array.from(map.entries())
    .map(([key, g]) => ({
      key,
      method: g.method,
      route: g.route,
      count: g.durations.length,
      avgDuration: Math.round(g.durations.reduce((a, b) => a + b, 0) / g.durations.length),
      maxDuration: Math.max(...g.durations)
    }))
    .sort((a, b) => b.avgDuration - a.avgDuration)
})

const historicalTiming = computed(() => {
  if (!historyData.value || historyData.value.length < 2 || !testCase.value?.duration) return null
  const previous = historyData.value.filter(h => h.duration !== null && h.id !== testCase.value?.id)
  if (previous.length === 0) return null
  const avg = previous.reduce((sum, h) => sum + (h.duration || 0), 0) / previous.length
  const current = testCase.value.duration
  const diff = current - avg
  const pct = avg > 0 ? Math.round((diff / avg) * 100) : 0
  return { avg: Math.round(avg), current, diff: Math.round(diff), pct }
})

const metadata = computed(() => {
  return testCase.value?.testRun?.metadata as Record<string, unknown> | null | undefined
})

const scmInfo = computed(() => {
  const m = metadata.value
  if (!m?.scm) return null
  return m.scm as { commit?: string, branch?: string, author?: string, commitMessage?: string }
})

const ciInfo = computed(() => {
  const m = metadata.value
  if (!m?.ci) return null
  return m.ci as { provider?: string, buildNumber?: string, buildUrl?: string, workflow?: string }
})

const browserInfo = computed(() => {
  const m = metadata.value
  const htmlReport = m?.htmlReport as { projects?: Array<{ name?: string, use?: { browserName?: string, viewport?: { width?: number, height?: number } } }> } | undefined
  const project = htmlReport?.projects?.[0]
  if (!project) return null
  return {
    browserName: project.use?.browserName,
    viewport: project.use?.viewport
  }
})

const fixPrompt = computed(() => {
  if (!testCase.value || testCase.value.status === 'passed') return null
  return generateFixPrompt({
    title: testCase.value.title,
    location: testCase.value.location,
    status: testCase.value.status,
    error: testCase.value.error,
    retries: testCase.value.retries,
    steps: testCase.value.steps as unknown as FixPromptStep[] | null,
    networkRequests: testCase.value.networkRequests as unknown as FixPromptNetwork[] | null,
    webVitals: testCase.value.webVitals as unknown as FixPromptVitals | null,
    duration: testCase.value.duration,
    slowestStep: testCase.value.slowestStep,
    slowestStepDuration: testCase.value.slowestStepDuration
  })
})

interface FixPromptStep { title: string, duration: number, category: string }
interface FixPromptNetwork { method: string, url: string, status: number, duration: number }
interface FixPromptVitals { navigation?: { ttfb?: number, domInteractive?: number, domContentLoaded?: number, loadComplete?: number } | null }

const reportPath = computed(() => {
  const run = testCase.value?.testRun as Record<string, unknown> | undefined
  const reports = run?.reports as Array<{ type: string, path: string }> | undefined
  if (reports && reports.length > 0) {
    const htmlReport = reports.find((r: { type: string }) => r.type === 'html')
    if (htmlReport) return `/api/files/${getFileApiPath(htmlReport.path)}`
  }
  const runReportPath = run?.reportPath as string | undefined
  return runReportPath ? `/api/files/${getFileApiPath(runReportPath)}` : null
})

const UBadge = resolveComponent('UBadge')

const activeTab = ref('steps')

const metadataBlockCount = computed(() => {
  let count = 0
  if (scmInfo.value) count++
  if (ciInfo.value || testCase.value?.testRun?.environment) count++
  if (browserInfo.value) count++
  if (reportPath.value) count++
  return count
})

const summaryColSpanClass = computed(() => {
  const c = metadataBlockCount.value
  if (c === 0) return 'lg:col-span-8'
  if (c === 3) return 'lg:col-span-5'
  if (c === 2) return 'lg:col-span-4'
  return 'lg:col-span-5'
})

const blockColSpanClass = computed(() => {
  const c = metadataBlockCount.value
  if (c === 3) return 'lg:col-span-1'
  if (c === 2) return 'lg:col-span-2'
  if (c === 1) return 'lg:col-span-3'
  return ''
})

const tabItems = computed(() => [
  { label: `Steps (${steps.value.length})`, icon: 'i-lucide-list-checks', slot: 'steps' },
  { label: 'Error & Fix', icon: 'i-lucide-bug', slot: 'error', disabled: !testCase.value?.error },
  { label: 'Traces & Console', icon: 'i-lucide-terminal', slot: 'traces' },
  { label: `Performance (${performanceHints.value.length})`, icon: 'i-lucide-gauge', slot: 'performance', disabled: performanceHints.value.length === 0 },
  { label: `History (${historyData.value?.length ?? 0})`, icon: 'i-lucide-trending-up', slot: 'history', disabled: !historyData.value?.length }
])

const historyColumns: TableColumn<TestCaseHistoryPoint>[] = [
  {
    accessorKey: 'startTime',
    header: () => h('span', 'Date'),
    cell: ({ row }) => {
      const ts = row.getValue('startTime') as string | Date
      const d = new Date(ts)
      return h('span', { class: 'text-xs whitespace-nowrap' }, [
        h('span', { class: 'text-gray-500' }, d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })),
        h('span', { class: 'text-gray-400 ml-1' }, d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }))
      ])
    }
  },
  {
    accessorKey: 'status',
    header: () => h('span', 'Status'),
    cell: ({ row }) => {
      const status = row.getValue('status') as string
      const color = getStatusColor(status)
      return h(UBadge, { color, class: 'capitalize' }, () => status)
    }
  },
  {
    accessorKey: 'duration',
    header: () => h('span', 'Duration'),
    cell: ({ row }) => {
      const val = row.getValue('duration') as number | null
      return val !== null ? formatDuration(val) : h('span', { class: 'text-gray-400' }, '—')
    }
  },
  {
    accessorKey: 'retries',
    header: () => h('span', 'Retries'),
    cell: ({ row }) => {
      const retries = row.getValue('retries') as number | null
      return retries && retries > 0 ? retries.toString() : ''
    }
  },
  {
    accessorKey: 'runId',
    header: () => h('span', 'Run'),
    cell: ({ row }) => {
      const runId = row.getValue('runId') as number
      return h('a', {
        href: `/test-runs/${runId}`,
        class: 'text-primary hover:underline',
        onClick: (e: MouseEvent) => {
          e.preventDefault()
          navigateTo(`/test-runs/${runId}`)
        }
      }, `#${runId}`)
    }
  },
  {
    accessorKey: 'error',
    header: () => h('span', 'Error'),
    cell: ({ row }) => {
      const err = row.getValue('error') as string | null
      if (!err) return ''
      const truncated = err.length > 80 ? `${err.substring(0, 80)}…` : err
      return h('span', { class: 'text-red-600 text-xs truncate max-w-xs block', title: err }, truncated)
    }
  }
]

const stepCategoryColor: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  navigation: 'info',
  assertion: 'success',
  action: 'warning'
}

const stepColumns: TableColumn<PerformanceStep>[] = [
  {
    accessorKey: 'category',
    header: () => h('span', 'Category'),
    cell: ({ row }) => {
      const cat = row.getValue('category') as string
      const color = stepCategoryColor[cat] || 'neutral'
      return h(UBadge, { color, variant: 'soft', size: 'xs' }, () => cat)
    }
  },
  {
    accessorKey: 'title',
    header: () => h('span', 'Step'),
    cell: ({ row }) => {
      const title = row.getValue('title') as string
      return h('span', { class: 'truncate block text-sm' }, title)
    }
  },
  {
    accessorKey: 'duration',
    header: () => h('span', 'Duration'),
    cell: ({ row }) => {
      const dur = row.getValue('duration') as number
      const color = dur > 2000 ? 'text-red-600 font-medium' : dur > 500 ? 'text-orange-500' : 'text-gray-500'
      return h('span', { class: `${color} text-sm tabular-nums` }, formatDuration(dur))
    }
  }
]
</script>

<template>
  <UDashboardPanel id="test-case-detail">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              ...(testCase?.testRun?.project?.id ? [{ label: testCase.testRun.project.name || 'Project', to: `/projects/${testCase.testRun.project.id}` }] : [{ label: 'Project' }]),
              ...(testCase?.testRun?.id ? [{ label: `Test run #${testCase.testRun.id}`, to: `/test-runs/${testCase.testRun.id}` }] : [{ label: 'Test run' }]),
              { label: testCase?.title || `Test case #${testCaseId}` }
            ]"
          />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            size="md"
            label="Refresh"
            @click="() => refresh()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4">
        <!-- Hero section: summary card + metadata cards -->
        <div class="grid grid-cols-1 lg:grid-cols-8 gap-4 mb-4">
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
                      {{ steps.length }}
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

                <div v-if="historicalTiming" class="flex items-center gap-1.5 text-xs">
                  <UIcon name="i-lucide-clock" class="size-3.5 text-gray-400" />
                  <span class="text-gray-500">Current: <strong>{{ formatDuration(historicalTiming.current) }}</strong></span>
                  <span class="text-gray-300 mx-0.5">|</span>
                  <span class="text-gray-500">Avg: <strong>{{ formatDuration(historicalTiming.avg) }}</strong></span>
                  <span class="text-gray-300 mx-0.5">|</span>
                  <span :class="historicalTiming.diff > 0 ? 'text-red-600 font-medium' : 'text-green-600 font-medium'">
                    {{ historicalTiming.diff > 0 ? '+' : '' }}{{ historicalTiming.pct }}%
                  </span>
                </div>
              </div>
            </UCard>
          </div>

          <!-- Source -->
          <UCard v-if="scmInfo" :class="blockColSpanClass">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-git-branch" class="w-4 h-4 text-primary" />
                <span class="text-sm font-medium">Source</span>
              </div>
            </template>
            <div class="space-y-2 text-sm">
              <div v-if="scmInfo.branch" class="flex items-center gap-1.5">
                <UIcon name="i-lucide-git-branch" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span class="font-medium">{{ scmInfo.branch }}</span>
              </div>
              <div v-if="scmInfo.commit" class="flex items-center gap-1.5">
                <UIcon name="i-lucide-git-commit-horizontal" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <code class="text-xs font-mono bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ scmInfo.commit.length >= 8 ? scmInfo.commit.substring(0, 8) : scmInfo.commit }}</code>
              </div>
              <div v-if="scmInfo.author" class="flex items-center gap-1.5">
                <UIcon name="i-lucide-user" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span class="text-gray-600 dark:text-gray-400">{{ scmInfo.author }}</span>
              </div>
              <p v-if="scmInfo.commitMessage" class="text-gray-400 text-xs break-words pl-1">
                {{ scmInfo.commitMessage }}
              </p>
            </div>
          </UCard>

          <!-- CI / Env -->
          <UCard v-if="ciInfo || testCase?.testRun?.environment" :class="blockColSpanClass">
            <template #header>
              <div class="flex items-center gap-2">
                <UIcon name="i-lucide-cloud" class="w-4 h-4 text-primary" />
                <span class="text-sm font-medium">CI / Env</span>
              </div>
            </template>
            <div class="space-y-2 text-sm">
              <div v-if="testCase?.testRun?.environment" class="flex items-center gap-1.5">
                <UIcon name="i-lucide-server" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span class="rounded-full border px-2 py-0.5 text-xs bg-gray-50 dark:bg-gray-800">{{ testCase.testRun.environment }}</span>
              </div>
              <div v-if="ciInfo?.provider" class="flex items-center gap-1.5">
                <UIcon name="i-lucide-cloud" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span>{{ ciInfo.provider }}</span>
              </div>
              <div v-if="ciInfo?.buildNumber" class="flex items-center gap-1.5">
                <UIcon name="i-lucide-hash" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span>Build #{{ ciInfo.buildNumber }}</span>
              </div>
              <div v-if="ciInfo?.workflow" class="flex items-center gap-1.5">
                <UIcon name="i-lucide-workflow" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <span>{{ ciInfo.workflow }}</span>
              </div>
              <div v-if="ciInfo?.buildUrl" class="flex items-center gap-1.5">
                <UIcon name="i-lucide-external-link" class="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <a :href="ciInfo.buildUrl" target="_blank" class="text-primary hover:underline text-xs">View build</a>
              </div>
            </div>
          </UCard>

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
                <span class="capitalize">{{ browserInfo.browserName || 'Unknown' }}</span>
              </div>
              <div v-if="browserInfo.viewport" class="flex items-center gap-1.5">
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

        <UTabs
          v-model="activeTab"
          :items="tabItems"
        >
          <template #error>
            <div class="space-y-4 pt-4">
              <TestCaseErrorCard v-if="testCase?.error" :error="testCase.error" />
              <TestCaseFixPromptCard v-if="fixPrompt" :prompt="fixPrompt" />
            </div>
          </template>

          <template #steps>
            <div class="space-y-4 pt-4">
              <div v-if="steps.length > 0">
                <UTable
                  :data="steps"
                  :columns="stepColumns"
                  :ui="{
                    base: 'table-fixed border-separate border-spacing-0',
                    thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                    tbody: '[&>tr]:last:[&>td]:border-b-0',
                    th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                    td: 'border-b border-default'
                  }"
                />
              </div>
            </div>
          </template>

          <template #performance>
            <div class="space-y-4 pt-4">
              <div v-if="performanceHints.length > 0" class="space-y-2">
                <div
                  v-for="(hint, index) in performanceHints"
                  :key="index"
                  :class="[
                    'p-3 rounded-lg border',
                    hint.type === 'warning' ? 'bg-amber-50 dark:bg-amber-900/20 border-amber-200 dark:border-amber-800' : 'bg-blue-50 dark:bg-blue-900/20 border-blue-200 dark:border-blue-800'
                  ]"
                >
                  <div class="flex items-start gap-2">
                    <UIcon
                      :name="hint.type === 'warning' ? 'i-lucide-alert-triangle' : 'i-lucide-lightbulb'"
                      :class="hint.type === 'warning' ? 'text-amber-600' : 'text-blue-600'"
                      class="size-4 mt-0.5 shrink-0"
                    />
                    <div>
                      <p :class="hint.type === 'warning' ? 'text-amber-800 dark:text-amber-200 font-medium' : 'text-blue-800 dark:text-blue-200 font-medium'">
                        {{ hint.message }}
                      </p>
                      <p :class="hint.type === 'warning' ? 'text-amber-700 dark:text-amber-300' : 'text-blue-700 dark:text-blue-300'" class="mt-1">
                        {{ hint.details }}
                      </p>
                    </div>
                  </div>
                </div>
              </div>

              <UCard v-if="webVitals">
                <template #header>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-gauge" class="w-5 h-5 text-primary" />
                    <h3 class="text-lg font-medium">
                      Browser performance (Web Vitals)
                    </h3>
                  </div>
                </template>

                <div class="space-y-4">
                  <div v-if="webVitals.navigation" class="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div>
                      <p class="text-xs text-gray-500 uppercase tracking-wide">
                        TTFB
                      </p>
                      <p
                        class="text-xl font-semibold"
                        :class="webVitals.navigation.ttfb > 600 ? 'text-red-600' : webVitals.navigation.ttfb > 200 ? 'text-orange-500' : 'text-green-600'"
                      >
                        {{ formatDuration(webVitals.navigation.ttfb) }}
                      </p>
                      <p class="text-xs text-gray-400 mt-1">
                        Time to first byte
                      </p>
                    </div>
                    <div>
                      <p class="text-xs text-gray-500 uppercase tracking-wide">
                        DOM Interactive
                      </p>
                      <p
                        class="text-xl font-semibold"
                        :class="webVitals.navigation.domInteractive > 3000 ? 'text-red-600' : webVitals.navigation.domInteractive > 1500 ? 'text-orange-500' : 'text-green-600'"
                      >
                        {{ formatDuration(webVitals.navigation.domInteractive) }}
                      </p>
                      <p class="text-xs text-gray-400 mt-1">
                        DOM interactive
                      </p>
                    </div>
                    <div>
                      <p class="text-xs text-gray-500 uppercase tracking-wide">
                        DOMContentLoaded
                      </p>
                      <p
                        class="text-xl font-semibold"
                        :class="webVitals.navigation.domContentLoaded > 3000 ? 'text-red-600' : webVitals.navigation.domContentLoaded > 1500 ? 'text-orange-500' : 'text-green-600'"
                      >
                        {{ formatDuration(webVitals.navigation.domContentLoaded) }}
                      </p>
                      <p class="text-xs text-gray-400 mt-1">
                        DOMContentLoaded
                      </p>
                    </div>
                    <div>
                      <p class="text-xs text-gray-500 uppercase tracking-wide">
                        Load Complete
                      </p>
                      <p
                        class="text-xl font-semibold"
                        :class="webVitals.navigation.loadComplete > 5000 ? 'text-red-600' : webVitals.navigation.loadComplete > 3000 ? 'text-orange-500' : 'text-green-600'"
                      >
                        {{ formatDuration(webVitals.navigation.loadComplete) }}
                      </p>
                      <p class="text-xs text-gray-400 mt-1">
                        Page fully loaded
                      </p>
                    </div>
                  </div>

                  <div v-if="webVitals.paint && (webVitals.paint.firstPaint || webVitals.paint.firstContentfulPaint)" class="grid grid-cols-2 gap-4 pt-2 border-t">
                    <div v-if="webVitals.paint.firstPaint !== undefined">
                      <p class="text-xs text-gray-500 uppercase tracking-wide">
                        First Paint (FP)
                      </p>
                      <p class="text-xl font-semibold">
                        {{ formatDuration(webVitals.paint.firstPaint) }}
                      </p>
                    </div>
                    <div v-if="webVitals.paint.firstContentfulPaint !== undefined">
                      <p class="text-xs text-gray-500 uppercase tracking-wide">
                        First Contentful Paint (FCP)
                      </p>
                      <p
                        class="text-xl font-semibold"
                        :class="webVitals.paint.firstContentfulPaint > 3000 ? 'text-red-600' : webVitals.paint.firstContentfulPaint > 1800 ? 'text-orange-500' : 'text-green-600'"
                      >
                        {{ formatDuration(webVitals.paint.firstContentfulPaint) }}
                      </p>
                    </div>
                  </div>

                  <div v-if="webVitals.navigation?.url" class="text-xs text-gray-400 pt-1">
                    Page: <code class="bg-gray-100 dark:bg-gray-800 px-1 rounded">{{ webVitals.navigation.url }}</code>
                  </div>
                </div>
              </UCard>
            </div>
          </template>

          <template #traces>
            <div class="space-y-4 pt-4">
              <TestCaseTracesCard :traces="(traceData as any[]) || []" />
              <TestCaseConsoleCard
                v-if="(testCase as any)?.consoleLogs?.length"
                :entries="(testCase as any)?.consoleLogs ?? []"
              />
              <UCard v-if="groupedNetworkRequests.length > 0">
                <template #header>
                  <div class="flex items-center gap-2">
                    <UIcon name="i-lucide-network" class="w-5 h-5 text-primary" />
                    <h3 class="text-lg font-medium">
                      Network requests
                    </h3>
                  </div>
                </template>

                <div class="space-y-1 max-h-96 overflow-y-auto">
                  <div
                    v-for="req in groupedNetworkRequests"
                    :key="req.key"
                    class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
                  >
                    <div class="flex items-center gap-2 min-w-0">
                      <UBadge
                        :color="req.method === 'GET' ? 'info' : req.method === 'POST' ? 'success' : req.method === 'DELETE' ? 'error' : 'warning'"
                        variant="soft"
                        size="xs"
                        class="font-mono shrink-0"
                      >
                        {{ req.method }}
                      </UBadge>
                      <code class="truncate text-xs">{{ req.route }}</code>
                      <span v-if="req.count > 1" class="text-gray-400 text-xs shrink-0">×{{ req.count }}</span>
                    </div>
                    <span
                      class="ml-2 shrink-0"
                      :class="req.avgDuration > 1000 ? 'text-red-600 font-medium' : req.avgDuration > 500 ? 'text-orange-500' : 'text-gray-500'"
                    >{{ formatDuration(req.avgDuration) }}</span>
                  </div>
                </div>
              </UCard>
            </div>
          </template>

          <template #history>
            <div class="space-y-4 pt-4">
              <div v-if="historyData && historyData.length > 0">
                <div class="space-y-4">
                  <TestCaseHistoryChart :data="historyData" :height="200" />

                  <UTable
                    :data="historyData"
                    :columns="historyColumns"
                    :ui="{
                      base: 'table-fixed border-separate border-spacing-0',
                      thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                      tbody: '[&>tr]:last:[&>td]:border-b-0',
                      th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                      td: 'border-b border-default'
                    }"
                  />
                </div>
              </div>
            </div>
          </template>
        </UTabs>
      </div>
    </template>
  </UDashboardPanel>
</template>
