<script setup lang="ts">
import { h, resolveComponent } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { TestRunDetails, TestRunSummary, ProjectWithTestRuns } from '~~/types/api'
import { useRunComparison } from '~/composables/useRunComparison'
import type { ComparisonRow } from '~/composables/useRunComparison'

const route = useRoute()
const router = useRouter()
const projectId = route.params.id as string

const { data: project, refresh: refreshProject } = await useFetch<ProjectWithTestRuns>(`/api/projects/${projectId}`)

useHead(computed(() => ({ title: `${project.value?.label || project.value?.name || 'Project'} — Compare runs — Piwi Dashboard` })))

interface RunOption {
  label: string
  value: number
}

function formatRunLabel(run: TestRunSummary): string {
  const date = prettyDateFormat(run.startTime, { dateOnly: true })
  const commitSuffix = (run.metadata?.scm?.commit) ? ` (${run.metadata.scm.commit.substring(0, 7)})` : ''
  return `Run #${run.id} — ${date}${commitSuffix}`
}

const runOptions = computed<RunOption[]>(() => {
  if (!project.value?.testRuns) return []
  return [...project.value.testRuns].reverse().map(run => ({
    label: formatRunLabel(run),
    value: run.id
  }))
})

const selectedRunOptionA = ref<RunOption | undefined>(undefined)
const selectedRunOptionB = ref<RunOption | undefined>(undefined)

const queryRunA = computed(() => route.query.runA ? Number(route.query.runA) : null)
const queryRunB = computed(() => route.query.runB ? Number(route.query.runB) : null)

watch(runOptions, (options) => {
  if (queryRunA.value) {
    const match = options.find(o => o.value === queryRunA.value)
    if (match) selectedRunOptionA.value = match
  }
  if (queryRunB.value) {
    const match = options.find(o => o.value === queryRunB.value)
    if (match) selectedRunOptionB.value = match
  }
}, { immediate: true })

function syncQueryParams() {
  const query: Record<string, string> = {}
  if (selectedRunOptionA.value) query.runA = String(selectedRunOptionA.value.value)
  if (selectedRunOptionB.value) query.runB = String(selectedRunOptionB.value.value)
  router.replace({ query })
}

function compareLatestWithPrevious() {
  if (runOptions.value.length >= 2) {
    selectedRunOptionA.value = runOptions.value[1]
    selectedRunOptionB.value = runOptions.value[0]
  }
}

const runADetails = ref<TestRunDetails | null>(null)
const runBDetails = ref<TestRunDetails | null>(null)
const loadingRunA = ref(false)
const loadingRunB = ref(false)

watch(selectedRunOptionA, async (opt) => {
  runADetails.value = null
  if (!opt?.value) return
  loadingRunA.value = true
  try {
    runADetails.value = await $fetch<TestRunDetails>(`/api/test-runs/${opt.value}`)
    syncQueryParams()
  } catch {
    // ignore
  } finally {
    loadingRunA.value = false
  }
})

watch(selectedRunOptionB, async (opt) => {
  runBDetails.value = null
  if (!opt?.value) return
  loadingRunB.value = true
  try {
    runBDetails.value = await $fetch<TestRunDetails>(`/api/test-runs/${opt.value}`)
    syncQueryParams()
  } catch {
    // ignore
  } finally {
    loadingRunB.value = false
  }
})

const { comparisonData, comparisonSummary } = useRunComparison(runADetails, runBDetails)

const UBadge = resolveComponent('UBadge')

const comparisonColumns: TableColumn<ComparisonRow>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<ComparisonRow>('Test case'),
    cell: ({ row }) => h('span', { class: 'font-medium' }, row.getValue('title'))
  },
  {
    accessorKey: 'statusA',
    header: createSortHeader<ComparisonRow>('Status A'),
    cell: ({ row }) => {
      const status = row.getValue('statusA') as string | null
      if (!status) return h('span', { class: 'text-gray-400' }, '—')
      const color = getStatusColor(status)
      return h(UBadge, { color, class: 'capitalize' }, () => status)
    }
  },
  {
    accessorKey: 'statusB',
    header: createSortHeader<ComparisonRow>('Status B'),
    cell: ({ row }) => {
      const status = row.getValue('statusB') as string | null
      if (!status) return h('span', { class: 'text-gray-400' }, '—')
      const color = getStatusColor(status)
      return h(UBadge, { color, class: 'capitalize' }, () => status)
    }
  },
  {
    accessorKey: 'durationA',
    header: createSortHeader<ComparisonRow>('Duration A'),
    cell: ({ row }) => {
      const val = row.getValue('durationA') as number | null
      return val !== null ? formatDuration(val) : h('span', { class: 'text-gray-400' }, '—')
    }
  },
  {
    accessorKey: 'durationB',
    header: createSortHeader<ComparisonRow>('Duration B'),
    cell: ({ row }) => {
      const val = row.getValue('durationB') as number | null
      return val !== null ? formatDuration(val) : h('span', { class: 'text-gray-400' }, '—')
    }
  },
  {
    accessorKey: 'delta',
    header: createSortHeader<ComparisonRow>('Delta'),
    cell: ({ row }) => {
      const delta = row.getValue('delta') as number | null
      if (delta === null) return h('span', { class: 'text-gray-400' }, '—')
      const sign = delta > 0 ? '+' : ''
      const color = delta > 0 ? 'text-red-600' : delta < 0 ? 'text-green-600' : 'text-gray-500'
      return h('span', { class: color }, `${sign}${formatDuration(delta)}`)
    }
  },
  {
    accessorKey: 'percentChange',
    header: createSortHeader<ComparisonRow>('Change'),
    cell: ({ row }) => {
      const pct = row.getValue('percentChange') as number | null
      if (pct === null) return h('span', { class: 'text-gray-400' }, '—')
      const sign = pct > 0 ? '+' : ''
      const color = pct > 10 ? 'text-red-600 font-medium' : pct < -10 ? 'text-green-600 font-medium' : 'text-gray-500'
      return h('span', { class: color }, `${sign}${pct}%`)
    }
  }
]
</script>

<template>
  <UDashboardPanel id="project-compare">
    <template #header>
      <UDashboardNavbar>
        <template #leading>
          <UDashboardSidebarCollapse />
          <UBreadcrumb
            :items="[
              { label: 'Home', icon: 'i-lucide-house', to: '/' },
              { label: 'Projects', to: '/projects' },
              { label: project?.label || project?.name || 'Project', to: `/projects/${projectId}` },
              { label: 'Compare runs' }
            ]"
          />
        </template>
        <template #right>
          <UButton
            icon="i-lucide-refresh-cw"
            size="md"
            label="Refresh"
            @click="refreshProject()"
          />
        </template>
      </UDashboardNavbar>
    </template>

    <template #body>
      <div class="p-4 space-y-6">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <div>
                <h2 class="text-xl font-semibold">
                  Compare runs
                </h2>
                <p class="text-sm text-gray-600 mt-1">
                  Compare two test runs side-by-side — status changes and duration deltas
                </p>
              </div>
              <UButton
                v-if="runOptions.length >= 2"
                icon="i-lucide-git-compare-arrows"
                size="sm"
                variant="outline"
                label="Latest vs previous"
                @click="compareLatestWithPrevious"
              />
            </div>
          </template>

          <div class="space-y-4">
            <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run A (baseline)</label>
                <USelectMenu
                  v-model="selectedRunOptionA"
                  :items="runOptions"
                  placeholder="Select run A..."
                />
              </div>
              <div>
                <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Run B (comparison)</label>
                <USelectMenu
                  v-model="selectedRunOptionB"
                  :items="runOptions"
                  placeholder="Select run B..."
                />
              </div>
            </div>

            <!-- Loading -->
            <div v-if="loadingRunA || loadingRunB" class="text-center py-8 text-gray-500">
              <UIcon name="i-lucide-loader-2" class="animate-spin mr-2" />
              Loading run data…
            </div>

            <!-- Comparison results -->
            <div v-else-if="selectedRunOptionA && selectedRunOptionB && comparisonData.length > 0" class="space-y-4">
              <!-- Summary badges -->
              <div class="space-y-2">
                <div class="flex flex-wrap gap-4 text-sm">
                  <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">Status changes</span>
                  <UBadge
                    v-if="comparisonSummary.newFailures > 0"
                    color="error"
                    variant="soft"
                    size="lg"
                  >
                    {{ comparisonSummary.newFailures }} new failure{{ comparisonSummary.newFailures > 1 ? 's' : '' }}
                  </UBadge>
                  <UBadge
                    v-if="comparisonSummary.recovered > 0"
                    color="success"
                    variant="soft"
                    size="lg"
                  >
                    {{ comparisonSummary.recovered }} recovered
                  </UBadge>
                  <UBadge
                    v-if="comparisonSummary.stillFailing > 0"
                    color="warning"
                    variant="soft"
                    size="lg"
                  >
                    {{ comparisonSummary.stillFailing }} still failing
                  </UBadge>
                  <span v-if="comparisonSummary.newFailures === 0 && comparisonSummary.recovered === 0 && comparisonSummary.stillFailing === 0" class="text-sm text-gray-500">No status changes</span>
                </div>
                <div class="flex flex-wrap gap-4 text-sm">
                  <span class="text-xs font-semibold text-gray-500 uppercase tracking-wider mr-1">Duration changes</span>
                  <UBadge
                    v-if="comparisonSummary.regressed > 0"
                    color="error"
                    variant="soft"
                    size="lg"
                  >
                    {{ comparisonSummary.regressed }} regressed
                  </UBadge>
                  <UBadge
                    v-if="comparisonSummary.improved > 0"
                    color="success"
                    variant="soft"
                    size="lg"
                  >
                    {{ comparisonSummary.improved }} improved
                  </UBadge>
                  <UBadge color="neutral" variant="soft" size="lg">
                    {{ comparisonSummary.unchanged }} unchanged
                  </UBadge>
                </div>
              </div>

              <UTable
                :data="comparisonData"
                :columns="comparisonColumns"
                :ui="{
                  base: 'table-fixed border-separate border-spacing-0',
                  thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
                  tbody: '[&>tr]:last:[&>td]:border-b-0',
                  th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
                  td: 'border-b border-default'
                }"
              />
            </div>

            <div v-else-if="!selectedRunOptionA || !selectedRunOptionB" class="text-center py-8 text-gray-500">
              Select two runs to compare test results.
            </div>

            <div v-else class="text-center py-8 text-gray-500">
              No overlapping test cases found between the selected runs.
            </div>
          </div>
        </UCard>
      </div>
    </template>
  </UDashboardPanel>
</template>
