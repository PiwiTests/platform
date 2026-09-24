<script setup lang="ts">
import {
  DEFAULT_ANALYTICS_SCOPE_STATE,
  isDefaultScopeState,
  type AnalyticsScopeState,
} from '#shared/analytics/scope-state';
import type { AnalyticsScopeSummary } from '#shared/analytics/types';
import type { FilterBarState } from '~/components/shared/FilterBar.vue';
import type { ProjectMenuItem } from '~~/types/api';

const props = defineProps<{
  modelValue: AnalyticsScopeState;
  availableProjects: ProjectMenuItem[];
  availableEnvironments: string[];
  availableBranches?: string[];
  summary?: AnalyticsScopeSummary | null;
}>();

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
// so analytics never grows its own copy of them. The period, project, branch
// policy and test pickers are analytics-only and ride in FilterBar's slots.
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
</script>

<template>
  <div class="space-y-2">
    <FilterBar
      v-model="filterBar"
      :available-environments="availableEnvironments"
      :available-branches="availableBranches ?? []"
      :branch-placeholder="modelValue.allBranches ? 'All branches' : 'Default branch'"
      :show-reset="false"
    >
      <template #leading>
        <AnalyticsPeriodPicker
          :period="modelValue.period"
          :compare="modelValue.compare"
          :granularity="modelValue.granularity"
          :summary="summary"
          @update:period="patch({ period: $event })"
          @update:compare="patch({ compare: $event })"
          @update:granularity="patch({ granularity: $event })"
        />

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
      </template>

      <template #trailing>
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
        <UButton v-if="!isDefault" variant="ghost" size="sm" color="neutral" icon="i-lucide-x" @click="reset">
          Reset
        </UButton>
      </template>
    </FilterBar>

    <p v-if="summary" class="text-xs text-muted" data-testid="analytics-scope-line">
      <ClientOnly>
        <span>{{ periodRange(summary) }}</span>
      </ClientOnly>
      <template v-if="summary.comparison"> · compared with {{ summary.comparison.label.toLowerCase() }} </template>
      <template v-for="note in [summary.period.fallback, ...summary.notes].filter(Boolean)" :key="note!">
        · {{ note }}
      </template>
    </p>
  </div>
</template>
