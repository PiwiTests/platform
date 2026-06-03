<script setup lang="ts">
import type { PerformanceStep, WebVitals, NetworkRequest, TestCaseHistoryPoint } from '~~/types/api'
import type { TableColumn } from '@nuxt/ui'
import { h, resolveComponent } from 'vue'
import { getPerformanceHints } from '~/utils/performance-hints'

const route = useRoute()
const testCaseId = route.params.id

const { data: testCase, refresh } = await useFetch(`/api/test-cases/${testCaseId}`)
const { data: historyData } = await useFetch<TestCaseHistoryPoint[]>(`/api/test-cases/${testCaseId}/history`)

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

// Group network requests by method + normalized route for per-test display
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

const UBadge = resolveComponent('UBadge')

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
      <div class="p-4 space-y-4">
        <UCard>
          <template #header>
            <div class="flex justify-between items-center">
              <h2 class="text-xl font-semibold">
                Test case #{{ testCase?.id }}
              </h2>
              <UBadge v-if="testCase" :color="getStatusColor(testCase.status)" size="lg">
                {{ testCase.status }}
              </UBadge>
            </div>
          </template>

          <div class="space-y-4">
            <div>
              <p class="text-sm text-gray-500">
                Title
              </p>
              <p class="font-medium text-lg">
                {{ testCase?.title }}
              </p>
            </div>

            <div v-if="testCase?.location">
              <p class="text-sm text-gray-500">
                Location
              </p>
              <code class="text-sm bg-gray-100 dark:bg-gray-800 p-2 rounded block">{{ testCase.location }}</code>
            </div>

            <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div>
                <p class="text-sm text-gray-500">
                  Duration
                </p>
                <p class="font-medium">
                  {{ formatDuration(testCase?.duration) }}
                </p>
              </div>
              <div>
                <p class="text-sm text-gray-500">
                  Retries
                </p>
                <p class="font-medium">
                  {{ testCase?.retries }}
                </p>
              </div>
              <div>
                <p class="text-sm text-gray-500">
                  Status
                </p>
                <p class="font-medium">
                  {{ testCase?.status }}
                </p>
              </div>
              <div v-if="testCase?.slowestStep">
                <p class="text-sm text-gray-500">
                  Slowest step
                </p>
                <p class="font-medium text-orange-600">
                  {{ testCase.slowestStep }}
                  <span v-if="testCase.slowestStepDuration" class="text-sm">
                    ({{ formatDuration(testCase.slowestStepDuration) }})
                  </span>
                </p>
              </div>
            </div>

            <div v-if="testCase?.error" class="pt-4 border-t">
              <p class="text-sm text-gray-500 mb-2">
                Error details
              </p>
              <pre class="text-sm bg-red-50 dark:bg-red-900/20 text-red-800 dark:text-red-200 p-4 rounded overflow-x-auto">{{ testCase.error }}</pre>
            </div>
          </div>
        </UCard>

        <!-- Test Case History -->
        <UCard v-if="historyData && historyData.length > 0">
          <template #header>
            <div class="flex items-center gap-2">
              <UIcon name="i-lucide-trending-up" class="w-5 h-5 text-primary" />
              <h3 class="text-lg font-medium">
                History ({{ historyData.length }} runs)
              </h3>
            </div>
          </template>

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
        </UCard>

        <!-- Performance Hints -->
        <div v-if="performanceHints.length > 0" class="space-y-2">
          <div
            v-for="(hint, index) in performanceHints"
            :key="index"
            :class="[
              'p-3 rounded-lg border text-sm',
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

        <!-- Steps Table -->
        <UCard v-if="steps.length > 0">
          <template #header>
            <h3 class="text-lg font-medium">
              Steps ({{ steps.length }})
            </h3>
          </template>

          <div class="space-y-1 max-h-96 overflow-y-auto">
            <div
              v-for="(step, index) in steps"
              :key="index"
              class="flex items-center justify-between py-1.5 px-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 text-sm"
            >
              <div class="flex items-center gap-2 min-w-0">
                <UBadge
                  :color="step.category === 'navigation' ? 'info' : step.category === 'assertion' ? 'success' : step.category === 'action' ? 'warning' : 'neutral'"
                  variant="soft"
                  size="xs"
                >
                  {{ step.category }}
                </UBadge>
                <span class="truncate">{{ step.title }}</span>
              </div>
              <span class="text-gray-500 ml-2 shrink-0">{{ formatDuration(step.duration) }}</span>
            </div>
          </div>
        </UCard>

        <!-- Web Vitals card -->
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

        <!-- Network Requests per test case -->
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
  </UDashboardPanel>
</template>
