<script setup lang="ts">
interface SpanTypeItem {
  key: string;
  label: string;
  checked: boolean;
}

defineProps<{
  workerCount: number;
  shardTotal?: number | null;
  testCount: number;
  hookCount: number;
  waitCount: number;
  /** Span-type toggles to offer (only the kinds present in the run). */
  spanTypes: SpanTypeItem[];
  live?: boolean;
}>();

defineEmits<{
  reset: [];
  toggleSpan: [key: string, visible: boolean];
}>();
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
      <UPopover v-if="spanTypes.length > 1" :content="{ align: 'end' }">
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
          <div class="p-2 flex flex-col gap-2 min-w-56">
            <UCheckbox
              v-for="span in spanTypes"
              :key="span.key"
              :model-value="span.checked"
              :label="span.label"
              @update:model-value="$emit('toggleSpan', span.key, $event === true)"
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
