<script setup lang="ts">
/**
 * The Filters block at the top of an analytics dashboard: the scope every widget
 * counts, grouped by what each control filters (Period, Runs, Tests), with
 * *Reset* in the block's header. Below `sm` the block starts folded to a
 * one-line summary of the active filters; wider, it starts open.
 */
import { hasTestFilter } from '#shared/analytics/scope';
import {
  DEFAULT_ANALYTICS_SCOPE_STATE,
  isDefaultScopeState,
  scopeFromState,
  type AnalyticsScopeState,
} from '#shared/analytics/scope-state';
import type { AnalyticsScopeSummary } from '#shared/analytics/types';
import type { FilterBarState } from '~/components/shared/FilterBar.vue';
import type { ProjectMenuItem } from '~~/types/api';

const props = withDefaults(
  defineProps<{
    modelValue: AnalyticsScopeState;
    availableProjects: ProjectMenuItem[];
    availableEnvironments: string[];
    availableBranches?: string[];
    summary?: AnalyticsScopeSummary | null;
    /** The block's heading: *Default filters* while a dashboard is edited. */
    title?: string;
  }>(),
  { availableBranches: () => [], summary: null, title: 'Filters' },
);

const emit = defineEmits<{
  'update:modelValue': [value: AnalyticsScopeState];
}>();

function patch(change: Partial<AnalyticsScopeState>) {
  emit('update:modelValue', { ...props.modelValue, ...change });
}

const projectItems = computed(() => props.availableProjects.map((p) => ({ label: p.label || p.name, value: p.id })));

const projectIds = computed({
  get: () => props.modelValue.projectIds,
  set: (val: number[]) => patch({ projectIds: val }),
});

function projectLabel(id: number) {
  return projectItems.value.find((item) => item.value === id)?.label ?? `#${id}`;
}

/** The one project in scope, for *Save as selection*. */
const singleProjectId = computed(() => {
  if (props.modelValue.projectIds.length === 1) return props.modelValue.projectIds[0]!;
  return props.availableProjects.length === 1 ? props.availableProjects[0]!.id : null;
});

// Default branch plus unknown-branch runs, or every branch. Picking branches by
// hand overrides the policy, so the policy control steps aside.
const BRANCH_POLICY_ITEMS = [
  { label: 'Default branch', value: 'default' },
  { label: 'All branches', value: 'all' },
];
const branchPolicy = computed({
  get: () => (props.modelValue.allBranches ? 'all' : 'default'),
  set: (val: string) => patch({ allBranches: val === 'all' }),
});

// The environment, branch and full-runs controls come from the shared FilterBar,
// so analytics never grows its own copy of them. The project and branch policy
// pickers are analytics-only and ride in FilterBar's slots.
const filterBar = computed<FilterBarState>({
  get: () => ({
    environments: props.modelValue.environments,
    branches: props.modelValue.branches,
    fullRunsOnly: props.modelValue.fullRunsOnly,
  }),
  set: (val) => patch({ environments: val.environments, branches: val.branches, fullRunsOnly: val.fullRunsOnly }),
});

const isDefault = computed(() => isDefaultScopeState(props.modelValue));

function reset() {
  emit('update:modelValue', { ...DEFAULT_ANALYTICS_SCOPE_STATE });
}

/** "Sep 1, 2026 to Sep 24, 2026" for the resolved period (`to` is exclusive, so the last day shows). */
function periodRange(summary: AnalyticsScopeSummary): string {
  const prefs = activeLocalePrefs();
  const locale = prefs.locale === 'auto' ? undefined : prefs.locale;
  const timeZone = prefs.timeZone === 'auto' ? undefined : prefs.timeZone;
  const from = new Date(summary.period.from);
  const last = new Date(Math.max(from.getTime(), new Date(summary.period.to).getTime() - 1));
  const fmt = (d: Date) => d.toLocaleDateString(locale, { dateStyle: 'medium', timeZone });
  return `${fmt(from)} to ${fmt(last)}`;
}

/** "Last 30 days · vs previous period · 3 projects · default branch": what the folded block reads. */
const activeSummary = computed(() => {
  const state = props.modelValue;
  const parts: string[] = [props.summary?.period.label ?? state.period];
  if (props.summary?.comparison) parts.push(`vs ${props.summary.comparison.label.toLowerCase().replace(/^the /, '')}`);
  if (state.projectIds.length === 1) parts.push(projectLabel(state.projectIds[0]!));
  else if (state.projectIds.length > 1) parts.push(`${state.projectIds.length} projects`);
  if (state.environments.length === 1) parts.push(state.environments[0]!);
  else if (state.environments.length > 1) parts.push(`${state.environments.length} environments`);
  if (state.branches.length === 1) parts.push(state.branches[0]!);
  else if (state.branches.length > 1) parts.push(`${state.branches.length} branches`);
  else parts.push(state.allBranches ? 'all branches' : 'default branch');
  if (!state.fullRunsOnly) parts.push('partial runs included');
  if (hasTestFilter(scopeFromState(state))) parts.push('test filter');
  return parts.join(' · ');
});

// Open or folded: null follows the viewport (folded below `sm`, open above) in
// CSS alone, so the server render already matches; a click fixes it either way.
const expanded = ref<boolean | null>(null);
const wide = ref(true);
onMounted(() => {
  wide.value = window.matchMedia('(min-width: 640px)').matches;
});
const isOpen = computed(() => expanded.value ?? wide.value);

function toggle() {
  wide.value = window.matchMedia('(min-width: 640px)').matches;
  expanded.value = !isOpen.value;
}

const bodyClass = computed(() => (expanded.value === null ? 'hidden sm:block' : expanded.value ? '' : 'hidden'));
const summaryClass = computed(() => (expanded.value === null ? 'sm:hidden' : expanded.value ? 'hidden' : ''));
</script>

<template>
  <section
    class="rounded-lg border border-default bg-default"
    data-shot="analytics-scope-bar"
    data-testid="analytics-filters"
  >
    <div class="flex items-center gap-2 px-3 py-2 sm:px-4 min-h-11">
      <h2 class="shrink-0 text-sm font-semibold text-highlighted">
        <button
          type="button"
          class="flex items-center gap-1.5 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-primary"
          :aria-expanded="isOpen"
          aria-controls="analytics-filters-body"
          data-testid="analytics-filters-toggle"
          @click="toggle"
        >
          <UIcon
            :name="isOpen ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-4 shrink-0 text-muted"
          />
          {{ title }}
        </button>
      </h2>
      <span
        class="min-w-0 flex-1 line-clamp-2 text-xs text-muted cursor-pointer"
        :class="summaryClass"
        :title="activeSummary"
        data-testid="analytics-filters-summary"
        @click="toggle"
      >
        {{ activeSummary }}
      </span>
      <UButton
        v-if="!isDefault"
        class="ml-auto shrink-0"
        variant="ghost"
        size="sm"
        color="neutral"
        icon="i-lucide-x"
        @click="reset"
      >
        Reset
      </UButton>
    </div>

    <div id="analytics-filters-body" class="border-t border-default px-3 py-3 sm:px-4" :class="bodyClass">
      <dl class="grid gap-y-3 gap-x-4 sm:grid-cols-[4rem_minmax(0,1fr)] sm:items-start">
        <dt class="text-xs font-medium text-muted sm:pt-1.5">Period</dt>
        <dd class="min-w-0 space-y-1">
          <AnalyticsPeriodPicker
            :period="modelValue.period"
            :compare="modelValue.compare"
            :granularity="modelValue.granularity"
            :summary="summary"
            @update:period="patch({ period: $event })"
            @update:compare="patch({ compare: $event })"
            @update:granularity="patch({ granularity: $event })"
          />
          <p v-if="summary" class="text-xs text-muted" data-testid="analytics-scope-line">
            <ClientOnly>
              <span>{{ periodRange(summary) }}</span>
            </ClientOnly>
            <template v-if="summary.comparison">
              · compared with {{ summary.comparison.label.toLowerCase() }}
            </template>
            <template v-for="note in [summary.period.fallback, ...summary.notes].filter(Boolean)" :key="note!">
              · {{ note }}
            </template>
          </p>
        </dd>

        <dt class="text-xs font-medium text-muted sm:pt-1.5">Runs</dt>
        <dd class="min-w-0">
          <FilterBar
            v-model="filterBar"
            :available-environments="availableEnvironments"
            :available-branches="availableBranches"
            branch-placeholder="Pick branches"
            :show-reset="false"
          >
            <template #leading>
              <USelectMenu
                v-if="projectItems.length > 0"
                v-model="projectIds"
                :items="projectItems"
                value-key="value"
                multiple
                searchable
                size="sm"
                class="min-w-[170px]"
                placeholder="All projects"
              >
                <template #default="{ modelValue: selected }">
                  <div class="flex items-center gap-1.5">
                    <UIcon
                      name="i-lucide-folder"
                      class="size-3.5 shrink-0"
                      :class="(selected as number[]).length ? 'text-primary' : 'text-gray-400'"
                    />
                    <span v-if="!(selected as number[]).length" class="text-gray-500">All projects</span>
                    <span v-else-if="(selected as number[]).length === 1" class="truncate">{{
                      projectLabel((selected as number[])[0]!)
                    }}</span>
                    <span v-else>{{ (selected as number[]).length }} projects</span>
                  </div>
                </template>
              </USelectMenu>
            </template>

            <template #after-branches>
              <div v-if="modelValue.branches.length === 0" class="flex items-center gap-1">
                <USelect
                  v-model="branchPolicy"
                  :items="BRANCH_POLICY_ITEMS"
                  size="sm"
                  icon="i-lucide-git-branch"
                  class="min-w-[150px]"
                  aria-label="Branch policy"
                  data-testid="analytics-branch-policy"
                />
                <HelpHint topic="analytics.branch-policy" />
              </div>
            </template>
          </FilterBar>
        </dd>

        <dt class="text-xs font-medium text-muted sm:pt-1.5">Tests</dt>
        <dd class="min-w-0">
          <AnalyticsTestFilter
            :selection="modelValue.selection"
            :tests="modelValue.tests"
            :browsers="modelValue.browsers"
            :summary="summary"
            :single-project-id="singleProjectId"
            @update:selection="patch({ selection: $event })"
            @update:tests="patch({ tests: $event })"
            @update:browsers="patch({ browsers: $event })"
          />
        </dd>
      </dl>
    </div>
  </section>
</template>
