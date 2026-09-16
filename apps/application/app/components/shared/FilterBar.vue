<script setup lang="ts">
/**
 * The scope controls shared by every list on a screen: an environment select, a
 * branch select and a *Full runs only* toggle. One instance drives the runs
 * table, the trend chart, the flaky analysis and the performance tab of a
 * project, so they never disagree on what is in scope. The caller owns the
 * value and persists it (the project page keeps one cookie per project).
 *
 * Environments and branches are multi-select so a run matches when it is in any
 * of the chosen values; a single chosen value also scopes the server-side flaky
 * analysis. A control renders only when the data offers more than nothing to
 * pick from.
 */
export interface FilterBarState {
  environments: string[];
  branches: string[];
  fullRunsOnly: boolean;
}

const props = withDefaults(
  defineProps<{
    modelValue: FilterBarState;
    availableEnvironments: string[];
    availableBranches: string[];
    /** Hide the built-in reset button when the caller supplies its own via #trailing. */
    showReset?: boolean;
  }>(),
  { showReset: true },
);

const emit = defineEmits<{
  'update:modelValue': [value: FilterBarState];
}>();

const environments = computed({
  get: () => props.modelValue.environments,
  set: (val) => emit('update:modelValue', { ...props.modelValue, environments: val }),
});

const branches = computed({
  get: () => props.modelValue.branches,
  set: (val) => emit('update:modelValue', { ...props.modelValue, branches: val }),
});

const fullRunsOnly = computed({
  get: () => props.modelValue.fullRunsOnly,
  set: (val) => emit('update:modelValue', { ...props.modelValue, fullRunsOnly: val }),
});

const hasActiveFilters = computed(
  () =>
    props.modelValue.environments.length > 0 || props.modelValue.branches.length > 0 || !props.modelValue.fullRunsOnly,
);

function reset() {
  emit('update:modelValue', { environments: [], branches: [], fullRunsOnly: true });
}
</script>

<template>
  <div class="flex items-center gap-3 flex-wrap">
    <slot name="leading" />

    <USelectMenu
      v-if="availableEnvironments.length > 0"
      v-model="environments"
      :items="availableEnvironments"
      multiple
      placeholder="All environments"
      size="sm"
      class="min-w-[160px]"
    >
      <template #default="{ modelValue: selected }">
        <div class="flex items-center gap-1.5">
          <UIcon
            name="i-lucide-server"
            class="size-3.5 shrink-0"
            :class="(selected as string[]).length ? 'text-primary' : 'text-gray-400'"
          />
          <span v-if="!(selected as string[]).length" class="text-gray-500">All environments</span>
          <span v-else-if="(selected as string[]).length === 1">{{ (selected as string[])[0] }}</span>
          <span v-else>{{ (selected as string[]).length }} environments</span>
        </div>
      </template>
    </USelectMenu>

    <USelectMenu
      v-if="availableBranches.length > 0"
      v-model="branches"
      :items="availableBranches"
      multiple
      searchable
      placeholder="All branches"
      size="sm"
      class="min-w-[160px] max-w-[16rem]"
    >
      <template #default="{ modelValue: selected }">
        <div class="flex items-center gap-1.5 min-w-0">
          <UIcon
            name="i-lucide-git-branch"
            class="size-3.5 shrink-0"
            :class="(selected as string[]).length ? 'text-primary' : 'text-gray-400'"
          />
          <span v-if="!(selected as string[]).length" class="text-gray-500">All branches</span>
          <span v-else-if="(selected as string[]).length === 1" class="truncate">{{ (selected as string[])[0] }}</span>
          <span v-else>{{ (selected as string[]).length }} branches</span>
        </div>
      </template>
    </USelectMenu>

    <label
      class="flex items-center gap-1.5 cursor-pointer select-none text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
    >
      <UCheckbox v-model="fullRunsOnly" size="sm" />
      Full runs only
    </label>

    <slot name="trailing" />

    <UButton
      v-if="showReset && hasActiveFilters"
      variant="ghost"
      size="sm"
      color="neutral"
      icon="i-lucide-x"
      @click="reset"
    >
      Reset
    </UButton>
  </div>
</template>
