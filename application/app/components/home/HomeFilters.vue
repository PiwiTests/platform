<script setup lang="ts">
export interface HomeFilterState {
  environments: string[];
  fullRunsOnly: boolean;
}

const props = defineProps<{
  modelValue: HomeFilterState;
  availableEnvironments: string[];
}>();

const emit = defineEmits<{
  'update:modelValue': [value: HomeFilterState];
}>();

const selectedEnvironments = computed({
  get: () => props.modelValue.environments,
  set: (val) => emit('update:modelValue', { ...props.modelValue, environments: val }),
});

const fullRunsOnly = computed({
  get: () => props.modelValue.fullRunsOnly,
  set: (val) => emit('update:modelValue', { ...props.modelValue, fullRunsOnly: val }),
});

const hasActiveFilters = computed(() => props.modelValue.environments.length > 0 || !props.modelValue.fullRunsOnly);

function clearFilters() {
  emit('update:modelValue', { environments: [], fullRunsOnly: true });
}
</script>

<template>
  <div class="flex items-center gap-3 flex-wrap">
    <!-- Environment filter -->
    <USelectMenu
      v-if="availableEnvironments.length > 0"
      v-model="selectedEnvironments"
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

    <!-- Full runs only toggle -->
    <label
      class="flex items-center gap-1.5 cursor-pointer select-none text-sm text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100 transition-colors"
    >
      <UCheckbox v-model="fullRunsOnly" size="sm" />
      Full runs only
    </label>

    <!-- Clear filters -->
    <UButton v-if="hasActiveFilters" variant="ghost" size="sm" color="neutral" icon="i-lucide-x" @click="clearFilters">
      Reset
    </UButton>
  </div>
</template>
