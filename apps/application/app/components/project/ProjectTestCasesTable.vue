<script setup lang="ts">
import type { TestCasesPage, TestCaseWithStats } from '~~/types/api';
import type { TestCasesSort } from '#shared/handlers/projects';
import { buildTestRowBadges } from '~/utils/test-row-badges';

const props = defineProps<{
  projectId: string | number;
  /** Project name — forwarded to OpenInIdeLink for the JetBrains project hint. */
  projectName?: string | null;
  /** Mirror search/filter/sort/page state into the route query (shareable URLs, survives tab switches). */
  syncQuery?: boolean;
}>();

const emit = defineEmits<{ total: [total: number] }>();

const route = useRoute();
const router = useRouter();

// Group by File shows the spec-health numbers as headers; None is the flat list.
const GROUP_OPTIONS = ['none', 'file'] as const;
type GroupBy = (typeof GROUP_OPTIONS)[number];
const { raw: groupByRaw, set: setGroupBy } = useGroupByCookie('project-test-cases', GROUP_OPTIONS);
const groupBy = computed<GroupBy>(() => (groupByRaw.value as GroupBy) ?? 'none');
const grouped = computed(() => groupBy.value === 'file');

const GROUP_LIMIT = 1000;
const DEFAULT_PAGE_SIZE = 25;
const PAGE_SIZE_OPTIONS = [
  { label: '10 / page', value: 10 },
  { label: '25 / page', value: 25 },
  { label: '50 / page', value: 50 },
  { label: '100 / page', value: 100 },
];
const AGE_OPTIONS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'Last year', value: 365 },
  { label: 'All time', value: 0 },
];
const STATUS_OPTIONS = [
  { label: 'Passed', value: 'passed', color: 'green' },
  { label: 'Failed', value: 'failed', color: 'red' },
  { label: 'Flaky', value: 'flaky', color: 'orange' },
  { label: 'Skipped', value: 'skipped', color: 'gray' },
  { label: "Didn't run", value: 'didnotrun', color: 'amber' },
] as const;

// The public demo's seed data is anchored at a fixed past date, so an age
// window would render the catalog empty there — default to all time instead.
const defaultAge = useRuntimeConfig().public.demoMode ? 0 : 30;

const init = props.syncQuery ? route.query : {};
const page = ref(Math.max(1, Number(init.page) || 1));
const q = ref(typeof init.q === 'string' ? init.q : '');
const searchInput = ref(q.value);
const statuses = ref<string[]>(typeof init.status === 'string' ? init.status.split(',').filter(Boolean) : []);
const age = ref(typeof init.age === 'string' && init.age !== '' ? Math.max(0, Number(init.age) || 0) : defaultAge);
const tagsFilter = ref(typeof init.tags === 'string' ? init.tags : '');
const tagsInput = ref(tagsFilter.value);
const locksFilter = ref(typeof init.locks === 'string' ? init.locks : '');
const locksInput = ref(locksFilter.value);
// Owner filter — deep-linked from a cluster's "Owner" line; set only via the URL,
// cleared with its chip. Narrows to tests declared to / derived for that owner.
const ownerFilter = ref(typeof init.owner === 'string' ? init.owner : '');
const sort = ref<TestCasesSort>(typeof init.sort === 'string' ? (init.sort as TestCasesSort) : 'lastRun');
const dir = ref<'asc' | 'desc'>(init.dir === 'asc' ? 'asc' : 'desc');
const initialPageSize = Number(init.pageSize);
const pageSize = ref(PAGE_SIZE_OPTIONS.some((o) => o.value === initialPageSize) ? initialPageSize : DEFAULT_PAGE_SIZE);

watch(
  searchInput,
  useDebounceFn((value: string) => {
    q.value = value.trim();
  }, 300),
);
watch(
  tagsInput,
  useDebounceFn((value: string) => {
    tagsFilter.value = value.trim();
  }, 300),
);
watch(
  locksInput,
  useDebounceFn((value: string) => {
    locksFilter.value = value.trim();
  }, 300),
);
watch([q, statuses, tagsFilter, locksFilter, ownerFilter, age, sort, dir, pageSize, grouped], () => {
  page.value = 1;
});

const query = computed(() => ({
  limit: grouped.value ? GROUP_LIMIT : pageSize.value,
  offset: grouped.value ? 0 : (page.value - 1) * pageSize.value,
  ...(q.value ? { q: q.value } : {}),
  ...(statuses.value.length > 0 ? { status: statuses.value.join(',') } : {}),
  ...(tagsFilter.value ? { tags: tagsFilter.value } : {}),
  ...(locksFilter.value ? { locks: locksFilter.value } : {}),
  ...(ownerFilter.value ? { owner: ownerFilter.value } : {}),
  maxAgeDays: age.value,
  sort: sort.value,
  dir: dir.value,
}));

const { data, status, error, refresh } = useFetch<TestCasesPage>(`/api/projects/${props.projectId}/test-cases`, {
  query,
});

watch(
  () => data.value?.total,
  (total) => {
    if (total != null) emit('total', total);
  },
  { immediate: true },
);

if (props.syncQuery) {
  watch([q, statuses, tagsFilter, locksFilter, ownerFilter, age, sort, dir, page, pageSize], () => {
    router.replace({
      query: {
        ...route.query,
        q: q.value || undefined,
        status: statuses.value.length > 0 ? statuses.value.join(',') : undefined,
        tags: tagsFilter.value || undefined,
        locks: locksFilter.value || undefined,
        owner: ownerFilter.value || undefined,
        age: age.value !== defaultAge ? String(age.value) : undefined,
        sort: sort.value !== 'lastRun' ? sort.value : undefined,
        dir: dir.value !== 'desc' ? dir.value : undefined,
        page: page.value > 1 ? String(page.value) : undefined,
        pageSize: pageSize.value !== DEFAULT_PAGE_SIZE ? String(pageSize.value) : undefined,
      },
    });
  });
}

function toggleStatus(value: string) {
  statuses.value = statuses.value.includes(value)
    ? statuses.value.filter((s) => s !== value)
    : [...statuses.value, value];
}

const SORT_OPTIONS: { label: string; value: TestCasesSort }[] = [
  { label: 'Last run', value: 'lastRun' },
  { label: 'Test', value: 'title' },
  { label: 'Status', value: 'status' },
  { label: 'Runs', value: 'totalRuns' },
  { label: 'Pass rate', value: 'passRate' },
  { label: 'Avg duration', value: 'avgDuration' },
];

function toggleDir() {
  dir.value = dir.value === 'asc' ? 'desc' : 'asc';
}

/** Tags and ownership metadata rendered as the row's badges. */
function catalogBadges(tc: TestCaseWithStats) {
  return buildTestRowBadges({
    tags: tc.tags,
    locks: tc.locks,
    meta: {
      owner: tc.owner ?? undefined,
      priority: toTestPriority(tc.priority),
      feature: tc.feature ?? undefined,
    },
  });
}

const items = computed(() => data.value?.items ?? []);
const total = computed(() => data.value?.total ?? 0);
const showingFrom = computed(() => (total.value === 0 ? 0 : (page.value - 1) * pageSize.value + 1));
const showingTo = computed(() =>
  grouped.value ? items.value.length : Math.min(page.value * pageSize.value, total.value),
);

// ── Group by File: spec-health numbers as headers ─────────────────────────────
// The spec-file prefix matches the spec-health endpoint (first two path segments)
// so each group's header can carry that file's pass rate, flaky rate and timing.
interface SpecHealth {
  prefix: string;
  passRate: number;
  flakyRate: number;
  failureCount: number;
  testCount: number;
  avgDuration: number;
}

const { data: specHealth, execute: loadSpecHealth } = useFetch<{ specs: SpecHealth[] }>(
  () => `/api/projects/${props.projectId}/spec-health?days=90`,
  { lazy: true, server: false, immediate: false },
);

// Fetch the spec-health numbers the first time the file grouping is shown.
watch(
  grouped,
  (isGrouped) => {
    if (isGrouped && !specHealth.value) loadSpecHealth();
  },
  { immediate: true },
);

const specHealthByPrefix = computed(() => {
  const map = new Map<string, SpecHealth>();
  for (const s of specHealth.value?.specs ?? []) map.set(s.prefix, s);
  return map;
});

function specPrefix(filePath: string): string {
  return filePath.split(/[\\/]/).slice(0, 2).join('/');
}

function formatMs(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

const collapsedGroups = ref<Set<string>>(new Set());
function toggleGroup(prefix: string) {
  const next = new Set(collapsedGroups.value);
  if (next.has(prefix)) next.delete(prefix);
  else next.add(prefix);
  collapsedGroups.value = next;
}

const fileGroups = computed(() => {
  const groups = new Map<string, TestCaseWithStats[]>();
  for (const item of items.value) {
    const prefix = specPrefix(item.filePath);
    if (!groups.has(prefix)) groups.set(prefix, []);
    groups.get(prefix)!.push(item);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([prefix, rows]) => {
      const health = specHealthByPrefix.value.get(prefix);
      const metrics = health
        ? [
            {
              label: 'Pass',
              value: `${Math.round(health.passRate * 100)}%`,
              tone: (health.passRate >= 0.9 ? 'good' : health.passRate > 0 ? 'bad' : 'muted') as
                | 'good'
                | 'bad'
                | 'muted',
            },
            { label: 'Flaky', value: `${Math.round(health.flakyRate * 100)}%`, tone: 'muted' as const },
            {
              label: 'Failures',
              value: String(health.failureCount),
              tone: (health.failureCount > 0 ? 'bad' : 'muted') as 'bad' | 'muted',
            },
            { label: 'Tests', value: String(health.testCount), tone: 'muted' as const },
            { label: 'Avg', value: formatMs(health.avgDuration), tone: 'muted' as const },
          ]
        : null;
      return { prefix, rows, metrics, open: !collapsedGroups.value.has(prefix) };
    });
});
const hasSearchOrStatusFilter = computed(
  () =>
    q.value !== '' ||
    statuses.value.length > 0 ||
    tagsFilter.value !== '' ||
    locksFilter.value !== '' ||
    ownerFilter.value !== '',
);
const hasAnyFilter = computed(() => hasSearchOrStatusFilter.value || age.value !== 0);
const initialLoading = computed(() => status.value === 'pending' && !data.value);

defineExpose({ refresh });
</script>

<template>
  <SectionCard title="Tests" icon="i-lucide-flask-conical" :count="data?.total" help="project.test-cases">
    <template #actions>
      <UButton
        icon="i-lucide-refresh-cw"
        size="sm"
        color="neutral"
        variant="ghost"
        aria-label="Refresh tests"
        :loading="status === 'pending' && !!data"
        @click="() => refresh()"
      />
    </template>

    <FilterToolbar class="mb-4">
      <template #start>
        <div class="flex items-center gap-1.5">
          <span class="text-xs text-muted">Group by</span>
          <div class="flex items-center rounded-md border border-default overflow-hidden">
            <button
              type="button"
              class="px-2 py-1 text-xs transition-colors"
              :class="groupBy === 'none' ? 'bg-primary text-white dark:text-white' : 'text-muted hover:bg-elevated/60'"
              title="Flat list"
              @click="setGroupBy('none')"
            >
              None
            </button>
            <button
              type="button"
              class="px-2 py-1 text-xs transition-colors"
              :class="groupBy === 'file' ? 'bg-primary text-white dark:text-white' : 'text-muted hover:bg-elevated/60'"
              title="Group by spec file, with per-file health"
              @click="setGroupBy('file')"
            >
              File
            </button>
          </div>
        </div>
        <span class="text-sm text-muted tabular-nums"> {{ total }} {{ total === 1 ? 'test' : 'tests' }} </span>
        <UButton
          v-if="ownerFilter"
          size="xs"
          color="neutral"
          variant="subtle"
          icon="i-lucide-users"
          trailing-icon="i-lucide-x"
          :title="`Clear owner filter: ${ownerFilter}`"
          @click="ownerFilter = ''"
        >
          Owner: {{ ownerFilter }}
        </UButton>
      </template>

      <UInput
        v-model="searchInput"
        placeholder="Search title or file..."
        icon="i-lucide-search"
        size="sm"
        class="min-w-48 max-sm:flex-1"
        aria-label="Search tests"
      />
      <UInput
        v-model="tagsInput"
        placeholder="Tags (comma-separated)…"
        icon="i-lucide-tag"
        size="sm"
        class="min-w-44 max-sm:flex-1"
        aria-label="Filter by tag"
        title="Show only cases carrying every listed tag. A leading @ is optional."
      />
      <UInput
        v-model="locksInput"
        placeholder="Locks (comma-separated)…"
        icon="i-lucide-lock"
        size="sm"
        class="min-w-44 max-sm:flex-1"
        aria-label="Filter by lock"
        title="Show only cases carrying every listed lock name."
      />
      <div class="flex flex-wrap items-center gap-1">
        <button
          v-for="opt in STATUS_OPTIONS"
          :key="opt.value"
          type="button"
          class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
          :aria-pressed="statuses.includes(opt.value)"
          :class="
            statuses.includes(opt.value)
              ? opt.color === 'green'
                ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                : opt.color === 'red'
                  ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                  : opt.color === 'orange'
                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900/30 dark:text-orange-400'
                    : opt.color === 'amber'
                      ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-400'
                      : 'bg-gray-200 text-gray-700 dark:bg-gray-700 dark:text-gray-300'
              : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400 hover:bg-gray-200 dark:hover:bg-gray-700'
          "
          @click="toggleStatus(opt.value)"
        >
          <span
            class="size-2 rounded-full shrink-0"
            :class="
              opt.color === 'green'
                ? 'bg-green-500'
                : opt.color === 'red'
                  ? 'bg-red-500'
                  : opt.color === 'orange'
                    ? 'bg-orange-500'
                    : opt.color === 'amber'
                      ? 'bg-amber-500'
                      : 'bg-gray-400'
            "
          />
          {{ opt.label }}
        </button>
      </div>
      <USelect v-model="age" :items="AGE_OPTIONS" size="sm" class="w-36" aria-label="Last run age filter" />
      <div class="flex items-center gap-1">
        <span class="text-xs text-muted max-sm:sr-only">Sort</span>
        <USelect v-model="sort" :items="SORT_OPTIONS" size="sm" class="w-36" aria-label="Sort by" />
        <UButton
          size="sm"
          color="neutral"
          variant="outline"
          :icon="dir === 'asc' ? 'i-lucide-arrow-up' : 'i-lucide-arrow-down'"
          :title="dir === 'asc' ? 'Ascending' : 'Descending'"
          aria-label="Toggle sort direction"
          @click="toggleDir"
        />
      </div>
    </FilterToolbar>

    <LoadingState v-if="initialLoading" text="Loading test cases..." />

    <ErrorState v-else-if="error" :text="errorMessage(error, 'Failed to load test cases')">
      <template #action>
        <UButton size="sm" variant="outline" @click="() => refresh()">Retry</UButton>
      </template>
    </ErrorState>

    <template v-else-if="total === 0">
      <EmptyState v-if="!hasAnyFilter" icon="i-lucide-flask-conical" text="No test cases yet for this project." />
      <EmptyState v-else icon="i-lucide-search-x" text="No test cases match your filters.">
        <div class="mt-3 flex items-center justify-center gap-2">
          <UButton v-if="age !== 0" size="sm" variant="outline" @click="age = 0">Show all time</UButton>
          <UButton
            v-if="hasSearchOrStatusFilter"
            size="sm"
            variant="ghost"
            @click="
              () => {
                searchInput = '';
                q = '';
                statuses = [];
              }
            "
          >
            Clear filters
          </UButton>
        </div>
      </EmptyState>
    </template>

    <template v-else>
      <div :class="{ 'opacity-60 pointer-events-none': status === 'pending' }" class="transition-opacity">
        <!-- Group by File: a header carries the spec-health numbers per spec file -->
        <template v-if="grouped">
          <UAlert
            v-if="items.length < total"
            color="warning"
            variant="subtle"
            icon="i-lucide-triangle-alert"
            class="mb-3"
            :title="`Showing the first ${items.length} of ${total} tests — narrow the search or filters to see the rest.`"
          />
          <div class="space-y-3">
            <div
              v-for="group in fileGroups"
              :key="group.prefix"
              class="rounded-lg border border-default overflow-hidden"
            >
              <TestRowGroup
                :label="group.prefix"
                :count="group.rows.length"
                :open="group.open"
                :metrics="group.metrics"
                icon="i-lucide-folder"
                @toggle="toggleGroup(group.prefix)"
              />
              <div v-if="group.open">
                <TestRow
                  v-for="tc in group.rows"
                  :key="tc.id"
                  :href="`/test-cases/${tc.id}`"
                  :title="tc.title"
                  :status="tc.status"
                  :file-path="tc.filePath"
                  :badges="catalogBadges(tc)"
                  :project-key="projectId"
                  :project-name="projectName"
                >
                  <template #metrics>
                    <CatalogRowFacts :tc="tc" />
                  </template>
                </TestRow>
              </div>
            </div>
          </div>
        </template>

        <!-- Flat list: one TestRow per test -->
        <div v-else class="rounded-lg border border-default overflow-hidden">
          <TestRow
            v-for="tc in items"
            :key="tc.id"
            :href="`/test-cases/${tc.id}`"
            :title="tc.title"
            :status="tc.status"
            :file-path="tc.filePath"
            :badges="catalogBadges(tc)"
            :project-key="projectId"
            :project-name="projectName"
          >
            <template #metrics>
              <CatalogRowFacts :tc="tc" />
            </template>
          </TestRow>
        </div>

        <template v-if="!grouped">
          <!-- Pagination footer -->
          <div class="mt-4 flex flex-wrap items-center justify-between gap-3">
            <div class="flex flex-wrap items-center gap-3">
              <span class="text-sm text-muted tabular-nums"
                >Showing {{ showingFrom }}–{{ showingTo }} of {{ total }}</span
              >
              <div class="flex items-center gap-1.5">
                <span class="text-sm text-muted">Rows per page</span>
                <USelect
                  v-model="pageSize"
                  :items="PAGE_SIZE_OPTIONS"
                  size="sm"
                  class="w-28"
                  aria-label="Rows per page"
                />
              </div>
            </div>
            <UPagination
              v-if="total > pageSize"
              v-model:page="page"
              :total="total"
              :items-per-page="pageSize"
              size="sm"
            />
          </div>
        </template>
      </div>
    </template>
  </SectionCard>
</template>
