<script setup lang="ts">
import { h, resolveComponent, computed, nextTick, watch, onUnmounted } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { TestCaseResult } from '~~/types/api'

const props = defineProps<{
  testCases: TestCaseResult[]
  isLive: boolean
}>()

const UBadge = resolveComponent('UBadge')

// Search and filter
const testCaseSearch = ref('')
const testCaseStatusFilter = ref<string>('all')
const testCaseStatusOptions = [
  { label: 'All statuses', value: 'all' },
  { label: 'Passed', value: 'passed' },
  { label: 'Failed', value: 'failed' },
  { label: 'Skipped', value: 'skipped' },
  { label: 'Flaky', value: 'flaky' },
]

const filteredTestCases = computed<TestCaseResult[]>(() => {
  let cases = props.testCases
  if (testCaseStatusFilter.value !== 'all') {
    cases = cases.filter(tc => tc.status === testCaseStatusFilter.value)
  }
  if (testCaseSearch.value) {
    const query = testCaseSearch.value.toLowerCase()
    cases = cases.filter(tc =>
      tc.title.toLowerCase().includes(query)
      || (tc.location && tc.location.toLowerCase().includes(query))
    )
  }
  return cases
})

// Pagination
const currentPage = ref(1)
const pageSize = 50

const totalPages = computed(() => Math.max(1, Math.ceil(filteredTestCases.value.length / pageSize)))

// Reset to page 1 when search/filter changes
watch([testCaseSearch, testCaseStatusFilter], () => {
  currentPage.value = 1
})

// Refresh tick for live running test durations
const liveRefreshTick = ref(0)
let liveRefreshTimer: ReturnType<typeof setInterval> | null = null

function startLiveRefreshTimer() {
  if (liveRefreshTimer) return
  liveRefreshTimer = setInterval(() => {
    liveRefreshTick.value++
  }, 1000)
}

function stopLiveRefreshTimer() {
  if (liveRefreshTimer) {
    clearInterval(liveRefreshTimer)
    liveRefreshTimer = null
  }
}

watch(() => props.isLive, (live) => {
  if (live) {
    startLiveRefreshTimer()
  } else {
    stopLiveRefreshTimer()
  }
})

onUnmounted(() => {
  stopLiveRefreshTimer()
})

const paginatedTestCases = computed<TestCaseResult[]>(() => {
  void liveRefreshTick.value
  const start = (currentPage.value - 1) * pageSize
  return filteredTestCases.value.slice(start, start + pageSize)
})

// Columns
const testCasesColumns: TableColumn<TestCaseResult>[] = [
  {
    accessorKey: 'title',
    header: createSortHeader<TestCaseResult>('Test case'),
    cell: ({ row }) => {
      return h('a', {
        href: `/test-cases/${row.original.id}`,
        class: 'text-primary hover:underline font-medium',
        onClick: (e: MouseEvent) => {
          e.preventDefault()
          navigateTo(`/test-cases/${row.original.id}`)
        }
      }, row.getValue('title'))
    }
  },
  {
    accessorKey: 'status',
    header: createSortHeader<TestCaseResult>('Status'),
    cell: ({ row }) => {
      const color = getStatusColor(row.getValue('status') as string)
      return h(UBadge, { color, class: 'capitalize' }, () => row.getValue('status'))
    }
  },
  {
    accessorKey: 'location',
    header: createSortHeader<TestCaseResult>('Location'),
    cell: ({ row }) => {
      const location = row.getValue('location') as string | undefined
      return location ? h('code', { class: 'text-xs' }, location) : ''
    }
  },
  {
    accessorKey: 'duration',
    header: createSortHeader<TestCaseResult>('Duration'),
    cell: ({ row }) => {
      if (row.original.status === 'running' && row.original.startedAt) {
        return formatDuration(Math.max(0, Date.now() - row.original.startedAt))
      }
      return formatDuration(row.getValue('duration'))
    }
  },
  {
    accessorKey: 'workerIndex',
    header: createSortHeader<TestCaseResult>('Worker'),
    cell: ({ row }) => {
      const wi = row.getValue('workerIndex') as number | null | undefined
      if (wi === null || wi === undefined) return ''
      return h(UBadge, { color: 'neutral', variant: 'soft', class: 'font-mono text-xs' }, () => `${wi}`)
    }
  },
  {
    accessorKey: 'slowestStep',
    header: createSortHeader<TestCaseResult>('Slowest step'),
    cell: ({ row }) => {
      const step = row.getValue('slowestStep') as string | null
      const stepDuration = row.original.slowestStepDuration
      if (!step) return ''
      return h('div', { class: 'text-xs' }, [
        h('span', { class: 'text-gray-600 dark:text-gray-400' }, step),
        stepDuration ? h('span', { class: 'ml-1 text-orange-600 font-medium' }, `(${formatDuration(stepDuration)})`) : null
      ].filter(Boolean))
    }
  },
  {
    accessorKey: 'retries',
    header: createSortHeader<TestCaseResult>('Retries'),
    cell: ({ row }) => {
      const retries = row.getValue('retries') as number | undefined
      return retries && retries > 0 ? retries.toString() : ''
    }
  },
  {
    accessorKey: 'actions',
    header: () => h('div', { class: 'text-right' }, 'Actions'),
    cell: ({ row }) => {
      const UButton = resolveComponent('UButton')
      return h('div', { class: 'flex justify-end' },
        h(UButton, {
          to: `/test-cases/${row.original.id}`,
          size: 'sm',
          variant: 'outline'
        }, () => 'View details')
      )
    }
  }
]

function scrollToCase(id: number) {
  const idx = filteredTestCases.value.findIndex(tc => tc.id === id)
  if (idx < 0) return
  const page = Math.floor(idx / pageSize) + 1
  currentPage.value = page
  nextTick(() => {
    const link = document.querySelector<HTMLAnchorElement>(`a[href="/test-cases/${id}"]`)
    if (link) {
      const tr = link.closest('tr')
      tr?.scrollIntoView({ behavior: 'smooth', block: 'center' })
      tr?.classList.add('animate-pulse', 'bg-yellow-100', 'dark:bg-yellow-900/30')
      setTimeout(() => {
        tr?.classList.remove('animate-pulse', 'bg-yellow-100', 'dark:bg-yellow-900/30')
      }, 3000)
    }
  })
}

defineExpose({ scrollToCase })
</script>

<template>
  <div>
    <div class="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4">
      <div class="flex items-center gap-2">
        <span v-if="isLive" class="text-sm text-gray-500 tabular-nums">
          {{ testCases.length }} completed
        </span>
        <span v-else class="text-sm text-gray-500 tabular-nums">
          {{ filteredTestCases.length }}{{ filteredTestCases.length !== testCases.length ? ` / ${testCases.length}` : '' }} cases
        </span>
      </div>
      <div class="flex items-center gap-2">
        <UInput
          v-model="testCaseSearch"
          placeholder="Search test cases..."
          icon="i-lucide-search"
          size="sm"
          class="min-w-48"
        />
        <USelect
          v-model="testCaseStatusFilter"
          :items="testCaseStatusOptions"
          size="sm"
          class="w-32"
        />
      </div>
    </div>

    <UTable
      v-if="filteredTestCases.length > 0"
      :data="paginatedTestCases"
      :columns="testCasesColumns"
      :ui="{
        base: 'table-fixed border-separate border-spacing-0',
        thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
        tbody: '[&>tr]:last:[&>td]:border-b-0 [&>tr]:hover:bg-gray-50 dark:[&>tr]:hover:bg-gray-900/50',
        th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
        td: 'border-b border-default'
      }"
    />

    <div v-if="filteredTestCases.length > pageSize" class="flex items-center justify-between mt-4">
      <span class="text-xs text-gray-500 tabular-nums">
        Page {{ currentPage }} of {{ totalPages }}
        &middot; {{ filteredTestCases.length }} total
      </span>
      <div class="flex items-center gap-1">
        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          icon="i-lucide-chevron-first"
          :disabled="currentPage === 1"
          @click="currentPage = 1"
        />
        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          icon="i-lucide-chevron-left"
          :disabled="currentPage === 1"
          @click="currentPage = Math.max(1, currentPage - 1)"
        />
        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          icon="i-lucide-chevron-right"
          :disabled="currentPage === totalPages"
          @click="currentPage = Math.min(totalPages, currentPage + 1)"
        />
        <UButton
          size="sm"
          color="neutral"
          variant="soft"
          icon="i-lucide-chevron-last"
          :disabled="currentPage === totalPages"
          @click="currentPage = totalPages"
        />
      </div>
    </div>

    <div v-else-if="testCases.length > 0" class="text-center py-10 text-gray-500">
      <UIcon name="i-lucide-search-x" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
      <p>No test cases match your filters.</p>
    </div>

    <div v-else class="text-center py-10 text-gray-500">
      <UIcon name="i-lucide-beaker" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
      <p>No test cases recorded for this run.</p>
    </div>
  </div>
</template>
