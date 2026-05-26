<script setup lang="ts">
import { h } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { QualityData, FlakyTestsData, FlakyTest, FailingTest, ProjectDetails } from '~~/types/api'

const route = useRoute()
const projectId = route.params.id

const { data: project } = await useFetch<ProjectDetails>(`/api/projects/${projectId}`)
const { data: qualityData, refresh: refreshQuality } = await useFetch<QualityData>(`/api/projects/${projectId}/quality`)
const { data: flakyData, refresh: refreshFlaky } = await useFetch<FlakyTestsData>(`/api/projects/${projectId}/flaky-tests`)

useHead(computed(() => ({ title: `${project.value?.label || project.value?.name || 'Project'} — Quality — Playwright Dashboard` })))

// Flaky tests table columns
const flakyTestsColumns: TableColumn<FlakyTest>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<FlakyTest>('Test case'),
    cell: ({ row }) => {
      return h('div', {}, [
        h('div', { class: 'font-medium' }, row.getValue('title')),
        h('code', { class: 'text-xs bg-gray-100 dark:bg-gray-800 p-1 rounded mt-1 block' }, row.original.filePath)
      ])
    }
  },
  {
    accessorKey: 'flakyCount',
    header: createSortHeader<FlakyTest>('Flaky count'),
    cell: ({ row }) => h('span', { class: 'font-medium text-yellow-600' }, row.getValue('flakyCount'))
  },
  {
    accessorKey: 'totalRuns',
    header: createSortHeader<FlakyTest>('Total runs'),
    cell: ({ row }) => row.getValue('totalRuns')
  },
  {
    accessorKey: 'flakyRate',
    header: createSortHeader<FlakyTest>('Flaky rate'),
    cell: ({ row }) => h('span', { class: 'text-yellow-600' }, `${row.getValue('flakyRate')}%`)
  },
  {
    accessorKey: 'lastFlakyDate',
    header: createSortHeader<FlakyTest>('Last flaky'),
    cell: ({ row }) => {
      const date = row.getValue('lastFlakyDate') as string | null
      if (!date) return h('span', { class: 'text-gray-400' }, '—')
      return new Date(date).toLocaleDateString()
    }
  }
]

// Failing tests table columns
const failingTestsColumns: TableColumn<FailingTest>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<FailingTest>('Test case'),
    cell: ({ row }) => {
      return h('div', {}, [
        h('div', { class: 'font-medium' }, row.getValue('title')),
        h('code', { class: 'text-xs bg-gray-100 dark:bg-gray-800 p-1 rounded mt-1 block' }, row.original.filePath)
      ])
    }
  },
  {
    accessorKey: 'failureCount',
    header: createSortHeader<FailingTest>('Failures'),
    cell: ({ row }) => h('span', { class: 'font-medium text-red-600' }, row.getValue('failureCount'))
  },
  {
    accessorKey: 'totalRuns',
    header: createSortHeader<FailingTest>('Total runs'),
    cell: ({ row }) => row.getValue('totalRuns')
  },
  {
    accessorKey: 'failureRate',
    header: createSortHeader<FailingTest>('Failure rate'),
    cell: ({ row }) => h('span', { class: 'text-red-600' }, `${row.getValue('failureRate')}%`)
  },
  {
    accessorKey: 'lastError',
    header: createSortHeader<FailingTest>('Last error'),
    cell: ({ row }) => {
      const error = row.getValue('lastError') as string | null
      if (!error) return h('span', { class: 'text-gray-400' }, '—')
      return h('code', { class: 'text-xs text-red-600 block truncate max-w-xs', title: error }, error.substring(0, 100))
    }
  }
]

function refresh() {
  refreshQuality()
  refreshFlaky()
}
</script>

<template>
  <UDashboardPanel id="project-quality">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project', to: `/projects/${projectId}` },
              { label: 'Quality' }
            ]"
          />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            size="md"
            label="Refresh"
            @click="refresh"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-6">
        <!-- Stability Summary Cards -->
        <div v-if="qualityData?.summary" class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          <UCard>
            <div class="flex items-center gap-4">
              <div class="p-3 bg-green-500/10 rounded-full">
                <UIcon name="i-lucide-check-circle" class="size-6 text-green-600" />
              </div>
              <div>
                <p class="text-2xl font-bold">
                  {{ qualityData.summary.overallPassRate }}%
                </p>
                <p class="text-sm text-gray-600">
                  Overall pass rate
                </p>
              </div>
            </div>
          </UCard>

          <UCard>
            <div class="flex items-center gap-4">
              <div class="p-3 bg-yellow-500/10 rounded-full">
                <UIcon name="i-lucide-alert-triangle" class="size-6 text-yellow-600" />
              </div>
              <div>
                <p class="text-2xl font-bold">
                  {{ qualityData.summary.overallFlakyRate }}%
                </p>
                <p class="text-sm text-gray-600">
                  Flaky rate
                </p>
              </div>
            </div>
          </UCard>

          <UCard>
            <div class="flex items-center gap-4">
              <div class="p-3 bg-red-500/10 rounded-full">
                <UIcon name="i-lucide-x-circle" class="size-6 text-red-600" />
              </div>
              <div>
                <p class="text-2xl font-bold">
                  {{ qualityData.summary.overallFailureRate }}%
                </p>
                <p class="text-sm text-gray-600">
                  Failure rate
                </p>
              </div>
            </div>
          </UCard>

          <UCard>
            <div class="flex items-center gap-4">
              <div class="p-3 bg-blue-500/10 rounded-full">
                <UIcon name="i-lucide-trophy" class="size-6 text-blue-600" />
              </div>
              <div>
                <p class="text-2xl font-bold">
                  {{ qualityData.summary.failureFreeStreak }}
                </p>
                <p class="text-sm text-gray-600">
                  Failure-free streak
                </p>
              </div>
            </div>
          </UCard>
        </div>

        <!-- Additional summary row -->
        <div v-if="flakyData" class="grid grid-cols-1 md:grid-cols-2 gap-4">
          <UCard>
            <div class="flex items-center gap-4">
              <div class="p-3 bg-emerald-500/10 rounded-full">
                <UIcon name="i-lucide-shield-check" class="size-6 text-emerald-600" />
              </div>
              <div>
                <p class="text-2xl font-bold">
                  {{ flakyData.neverFailed }}
                </p>
                <p class="text-sm text-gray-600">
                  Tests never failing (of {{ flakyData.totalTestCases }})
                </p>
              </div>
            </div>
          </UCard>

          <UCard>
            <div class="flex items-center gap-4">
              <div class="p-3 bg-purple-500/10 rounded-full">
                <UIcon name="i-lucide-bar-chart-3" class="size-6 text-purple-600" />
              </div>
              <div>
                <p class="text-2xl font-bold">
                  {{ qualityData?.summary.totalRuns || 0 }}
                </p>
                <p class="text-sm text-gray-600">
                  Runs analyzed
                </p>
              </div>
            </div>
          </UCard>
        </div>

        <!-- Flakiness Trend Chart -->
        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">
              Flakiness trend
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              Number of flaky tests per run over time
            </p>
          </template>

          <QualityTrendChart :data="qualityData?.trend || []" :height="300" mode="flakiness" />
        </UCard>

        <!-- Failure Rate Trend Chart -->
        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">
              Failure trend
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              Number of failed tests and failure rate over time
            </p>
          </template>

          <QualityTrendChart :data="qualityData?.trend || []" :height="300" mode="failure" />
        </UCard>

        <!-- Top Flaky Tests -->
        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">
              Top flaky tests
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              Tests that passed after retries — most frequently flaky first
            </p>
          </template>

          <UTable
            v-if="flakyData?.flakyTests && flakyData.flakyTests.length > 0"
            :data="flakyData.flakyTests"
            :columns="flakyTestsColumns"
            :ui="{
              base: 'table-fixed border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default'
            }"
          />

          <div v-else class="text-center py-8 text-gray-500">
            No flaky tests detected in recent runs. 🎉
          </div>
        </UCard>

        <!-- Top Failing Tests -->
        <UCard>
          <template #header>
            <h2 class="text-xl font-semibold">
              Top failing tests
            </h2>
            <p class="text-sm text-gray-600 mt-1">
              Tests with the highest failure count across recent runs
            </p>
          </template>

          <UTable
            v-if="flakyData?.failingTests && flakyData.failingTests.length > 0"
            :data="flakyData.failingTests"
            :columns="failingTestsColumns"
            :ui="{
              base: 'table-fixed border-separate border-spacing-0',
              thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
              tbody: '[&>tr]:last:[&>td]:border-b-0',
              th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
              td: 'border-b border-default'
            }"
          />

          <div v-else class="text-center py-8 text-gray-500">
            No failing tests in recent runs. 🎉
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
