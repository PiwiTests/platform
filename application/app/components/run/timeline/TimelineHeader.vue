<script setup lang="ts">
const props = defineProps<{
  workerCount: number;
  shardTotal?: number | null;
  testCount: number;
  hookCount: number;
  waitCount: number;
  live?: boolean;
}>();

defineEmits<{ reset: [] }>();

type SpanTypes = { tests: boolean; hooks: boolean; waits: boolean };
const spanTypes = defineModel<SpanTypes>('spanTypes', { required: true });

function setType(key: keyof SpanTypes, value: boolean) {
  spanTypes.value = { ...spanTypes.value, [key]: value };
}

// Only worth a filter when there's more than one span type to toggle.
const canFilter = computed(() => props.hookCount > 0 || props.waitCount > 0);
</script>

<template>
  <div class="flex items-center justify-between mb-2">
    <span class="text-xs text-gray-500 inline-flex items-center gap-1"
      ><span
        >{{ workerCount }} worker{{ workerCount > 1 ? 's' : '' }}
        <template v-if="shardTotal && shardTotal > 1">
          &middot; {{ shardTotal }} shard{{ shardTotal > 1 ? 's' : '' }}
        </template>
        &middot; {{ testCount }} tests
        <template v-if="hookCount > 0"> &middot; {{ hookCount }} hooks </template>
        <template v-if="waitCount > 0"> &middot; {{ waitCount }} waits </template></span
      >
      <HelpHint topic="run.timeline" />
    </span>
    <div class="flex items-center gap-1">
      <UPopover v-if="canFilter" :content="{ align: 'end' }">
        <UButton
          size="xs"
          color="neutral"
          variant="ghost"
          icon="i-lucide-list-filter"
          trailing-icon="i-lucide-chevron-down"
          title="Show or hide span types"
        >
          Span types
        </UButton>
        <template #content>
          <div class="p-2 flex flex-col gap-2 min-w-44">
            <UCheckbox
              :model-value="spanTypes.tests"
              label="Tests"
              @update:model-value="setType('tests', $event === true)"
            />
            <UCheckbox
              v-if="hookCount > 0"
              :model-value="spanTypes.hooks"
              label="Hooks & fixtures"
              @update:model-value="setType('hooks', $event === true)"
            />
            <UCheckbox
              v-if="waitCount > 0"
              :model-value="spanTypes.waits"
              label="Wasted waits"
              @update:model-value="setType('waits', $event === true)"
            />
          </div>
        </template>
      </UPopover>

      <UButton
        v-if="!live"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-rotate-ccw"
        @click="$emit('reset')"
      >
        Reset view
      </UButton>
    </div>
  </div>
</template>
