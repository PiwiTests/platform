<script setup lang="ts">
import { computed, nextTick, watch, ref, onUnmounted } from 'vue'
import type { TableColumn } from '@nuxt/ui'
import type { TestCaseResult } from '~~/types/api'

const props = defineProps<{
  testCases: TestCaseResult[]
  isLive: boolean
  failureClusterFilter?: number | null
  statusFilter?: string
}>()

// Search and filter
const testCaseSearch = ref('')
const activeStatuses = ref<string[]>([])

// Sync from RunSummary clicks: replace active statuses with clicked one
watch(() => props.statusFilter, (val) => {
  if (!val || val === 'all') {
    activeStatuses.value = []
  } else {
    activeStatuses.value = [val]
  }
})

const STATUS_OPTIONS = [
  { label: 'Passed', value: 'passed', color: 'green' },
  { label: 'Failed', value: 'failed', color: 'red' },
  { label: 'Skipped', value: 'skipped', color: 'gray' },
  { label: 'Flaky', value: 'flaky', color: 'orange' },
] as const

function toggleStatus(value: string) {
  const idx = activeStatuses.value.indexOf(value)
  if (idx >= 0) {
    activeStatuses.value = activeStatuses.value.filter(s => s !== value)
  } else {
    activeStatuses.value = [...activeStatuses.value, value]
  }
}

const testCaseBrowserFilter = ref<string>('all')

const testCaseBrowserOptions = computed(() => {
  const browsers = new Set<string>()
  for (const tc of props.testCases) {
    const name = tc.browser?.projectName
    if (name) browsers.add(name)
  }
  const items = [{ label: 'All browsers', value: 'all' }]
  for (const b of [...browsers].sort()) {
    items.push({ label: b, value: b })
  }
  return items
})

function matchesStatus(tc: TestCaseResult, filter: string): boolean {
  if (filter === 'failed') return tc.status === 'failed' || tc.status === 'timedOut' || tc.status === 'timedout'
  if (filter === 'flaky') return (tc.retries ?? 0) > 0
  return tc.status === filter
}

const filteredTestCases = computed<TestCaseResult[]>(() => {
  let cases = props.testCases
  if (props.failureClusterFilter != null) {
    cases = cases.filter(tc => tc.failureClusterId === props.failureClusterFilter)
  }
  if (activeStatuses.value.length > 0) {
    cases = cases.filter(tc => activeStatuses.value.some(s => matchesStatus(tc, s)))
  }
  if (testCaseBrowserFilter.value !== 'all') {
    cases = cases.filter(tc => tc.browser?.projectName === testCaseBrowserFilter.value)
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

// Reset scroll lock when live mode ends
watch(() => props.isLive, (live) => {
  if (!live) userScrolledAway.value = false
})

// Auto-scroll to bottom during live runs, unless user has scrolled away
const tableScrollRef = ref<{ $el: HTMLElement } | null>(null)
const userScrolledAway = ref(false)
let scrollListenerCleanup: (() => void) | null = null

function getScrollEl(): HTMLElement | null {
  return tableScrollRef.value?.$el ?? null
}

function isAtBottom(el: HTMLElement): boolean {
  return el.scrollHeight - el.scrollTop - el.clientHeight < 50
}

function onTableScroll() {
  const el = getScrollEl()
  if (!el) return
  userScrolledAway.value = !isAtBottom(el)
}

watch(tableScrollRef, (instance) => {
  scrollListenerCleanup?.()
  const el = instance?.$el
  if (el) {
    el.addEventListener('scroll', onTableScroll, { passive: true })
    scrollListenerCleanup = () => el?.removeEventListener('scroll', onTableScroll)
  }
})

onUnmounted(() => {
  scrollListenerCleanup?.()
})

// Auto-scroll to bottom when new items appear during a live run
watch(() => filteredTestCases.value.length, () => {
  if (!props.isLive || userScrolledAway.value) return
  nextTick(() => {
    const el = getScrollEl()
    if (el) el.scrollTop = el.scrollHeight
  })
})

// Columns (without cell render functions — using template slots for custom cells)
const testCasesColumns: TableColumn<TestCaseResult>[] = [
  {
    id: 'browser',
    accessorFn: (row: TestCaseResult) => row.browser?.projectName ?? '',
    header: createSortHeader<TestCaseResult>('Browser'),
  },
  {
    accessorKey: 'title',
    header: createSortHeader<TestCaseResult>('Test case'),
  },
  {
    accessorKey: 'status',
    header: createSortHeader<TestCaseResult>('Status'),
  },
  {
    accessorKey: 'location',
    header: createSortHeader<TestCaseResult>('Location'),
  },
  {
    accessorKey: 'duration',
    header: createSortHeader<TestCaseResult>('Duration'),
  },
  {
    accessorKey: 'workerIndex',
    header: createSortHeader<TestCaseResult>('Worker'),
  },
  {
    accessorKey: 'retries',
    header: createSortHeader<TestCaseResult>('Retries'),
  },
  {
    id: 'actions',
    header: () => h('div', { class: 'text-right' }, 'Actions'),
  }
]

const listRef = ref<HTMLElement | null>(null)
const highlightedCaseId = ref<number | null>(null)

function scrollToCase(id: number) {
  highlightedCaseId.value = id
  nextTick(() => {
    const row = listRef.value?.querySelector<HTMLElement>(`tr:has(a[href="/test-cases/${id}"])`)
    if (row) {
      const container = row.closest('table')?.parentElement
      if (container) {
        const containerTop = container.getBoundingClientRect().top
        const rowTop = row.getBoundingClientRect().top
        container.scrollBy({
          top: rowTop - containerTop - container.clientHeight / 2 + row.clientHeight / 2,
          behavior: 'smooth'
        })
      }
    }
    setTimeout(() => {
      highlightedCaseId.value = null
    }, 3000)
  })
}

defineExpose({ scrollToCase })
</script>

<template>
  <div ref="listRef">
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
        <div class="flex flex-wrap items-center gap-1">
          <button
            v-for="opt in STATUS_OPTIONS"
            :key="opt.value"
            class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
            :class="activeStatuses.includes(opt.value)
              ? opt.color === 'green' ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : opt.color === 'red' ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : opt.color === 'orange' ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'"
            @click="toggleStatus(opt.value)"
          >
            <span
              class="size-2 rounded-full shrink-0"
              :class="opt.color === 'green' ? 'bg-green-500' : opt.color === 'red' ? 'bg-red-500' : opt.color === 'orange' ? 'bg-orange-500' : 'bg-gray-400'"
            />
            {{ opt.label }}
          </button>
        </div>
        <USelect
          v-model="testCaseBrowserFilter"
          :items="testCaseBrowserOptions"
          size="sm"
          class="w-36"
        />
      </div>
    </div>

    <UTable
      v-if="filteredTestCases.length > 0"
      ref="tableScrollRef"
      sticky
      :data="filteredTestCases"
      :columns="testCasesColumns"
      class="max-h-[calc(100vh-28rem)]"
      :ui="{
        base: 'table-fixed border-separate border-spacing-0',
        thead: '[&>tr]:bg-elevated/50 [&>tr]:after:content-none',
        tbody: '[&>tr]:last:[&>td]:border-b-0 [&>tr]:hover:bg-gray-50 dark:[&>tr]:hover:bg-gray-900/50',
        th: 'first:rounded-l-lg last:rounded-r-lg border-y border-default first:border-l last:border-r',
        td: 'border-b border-default'
      }"
      :meta="{ class: { tr: (row: any) => highlightedCaseId === row.original.id ? 'animate-pulse bg-yellow-100 dark:bg-yellow-900/30' : '' } }"
    >
      <template #title-cell="{ row }">
        <a
          :href="`/test-cases/${row.original.id}`"
          class="text-primary hover:underline font-medium"
          @click.prevent="navigateTo(`/test-cases/${row.original.id}`)"
        >{{ row.original.title }}</a>
      </template>

      <template #status-cell="{ row }">
        <UBadge
          :color="getStatusColor(row.original.status === 'timedOut' || row.original.status === 'timedout' ? 'failed' : row.original.status)"
          class="capitalize"
        >
          {{ row.original.status === 'timedOut' || row.original.status === 'timedout' ? 'failed' : row.original.status }}
        </UBadge>
      </template>

      <template #location-cell="{ row }">
        <code v-if="row.original.location" class="text-xs">{{ row.original.location }}</code>
      </template>

      <template #duration-cell="{ row }">
        <span v-if="row.original.status === 'running'" class="text-info text-xs">In progress...</span>
        <span v-else>{{ formatDuration(row.original.duration) }}</span>
      </template>

      <template #workerIndex-cell="{ row }">
        <UBadge
          v-if="row.original.workerIndex != null"
          color="neutral"
          variant="soft"
          class="font-mono text-xs"
        >
          {{ row.original.workerIndex }}
        </UBadge>
      </template>

      <template #browser-cell="{ row }">
        <BrowserBadge :browser="row.original.browser" />
      </template>

      <template #retries-cell="{ row }">
        {{ row.original.retries && row.original.retries > 0 ? row.original.retries : '' }}
      </template>

      <template #actions-cell="{ row }">
        <div class="flex justify-end">
          <UButton
            :to="`/test-cases/${row.original.id}`"
            size="sm"
            variant="outline"
          >
            View details
          </UButton>
        </div>
      </template>
    </UTable>

    <div v-if="testCases.length > 0 && filteredTestCases.length === 0" class="text-center py-10 text-gray-500">
      <UIcon name="i-lucide-search-x" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
      <p>No test cases match your filters.</p>
    </div>

    <div v-else class="text-center py-10 text-gray-500">
      <UIcon name="i-lucide-beaker" class="size-8 mx-auto mb-2 text-gray-300 dark:text-gray-600" />
      <p>No test cases recorded for this run.</p>
    </div>
  </div>
</template>
