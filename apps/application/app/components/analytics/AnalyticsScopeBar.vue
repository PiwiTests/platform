<script setup lang="ts">
import { MAX_ANALYTICS_DAYS } from '#shared/analytics/scope';
import { DEFAULT_ANALYTICS_SCOPE_STATE, type AnalyticsScopeState } from '~/composables/useAnalyticsScope';
import type { FilterBarState } from '~/components/shared/FilterBar.vue';
import type { ProjectMenuItem } from '~~/types/api';

const props = defineProps<{
  modelValue: AnalyticsScopeState;
  availableProjects: ProjectMenuItem[];
  availableEnvironments: string[];
  availableBranches?: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: AnalyticsScopeState];
}>();

const PERIOD_ITEMS = [
  { label: 'Last 7 days', value: 7 },
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'Last year', value: 365 },
  { label: 'All time', value: MAX_ANALYTICS_DAYS },
];

const days = computed({
  get: () => props.modelValue.days,
  set: (val: number) => emit('update:modelValue', { ...props.modelValue, days: val }),
});

const projectItems = computed(() => props.availableProjects.map((p) => ({ label: p.label || p.name, value: p.id })));

const projectIds = computed({
  get: () => props.modelValue.projectIds,
  set: (val: number[]) => emit('update:modelValue', { ...props.modelValue, projectIds: val }),
});

function projectLabel(id: number) {
  return projectItems.value.find((item) => item.value === id)?.label ?? `#${id}`;
}

// The environment, branch and full-runs controls come from the shared FilterBar,
// so analytics never grows its own copy of them. The period and project pickers
// are analytics-only and ride in FilterBar's leading slot.
const filterBar = computed<FilterBarState>({
  get: () => ({
    environments: props.modelValue.environments,
    branches: props.modelValue.branches,
    fullRunsOnly: props.modelValue.fullRunsOnly,
  }),
  set: (val) =>
    emit('update:modelValue', {
      ...props.modelValue,
      environments: val.environments,
      branches: val.branches,
      fullRunsOnly: val.fullRunsOnly,
    }),
});

const isDefault = computed(
  () =>
    props.modelValue.days === DEFAULT_ANALYTICS_SCOPE_STATE.days &&
    props.modelValue.projectIds.length === 0 &&
    props.modelValue.environments.length === 0 &&
    props.modelValue.branches.length === 0 &&
    props.modelValue.fullRunsOnly === DEFAULT_ANALYTICS_SCOPE_STATE.fullRunsOnly,
);

function reset() {
  emit('update:modelValue', { ...DEFAULT_ANALYTICS_SCOPE_STATE });
}
</script>

<template>
  <FilterBar
    v-model="filterBar"
    :available-environments="availableEnvironments"
    :available-branches="availableBranches ?? []"
    :show-reset="false"
  >
    <template #leading>
      <USelect v-model="days" :items="PERIOD_ITEMS" size="sm" class="min-w-[140px]" icon="i-lucide-calendar-range" />

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

    <template #trailing>
      <UButton v-if="!isDefault" variant="ghost" size="sm" color="neutral" icon="i-lucide-x" @click="reset">
        Reset
      </UButton>
    </template>
  </FilterBar>
</template>
