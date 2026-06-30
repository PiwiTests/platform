<script setup lang="ts">
defineProps<{
  workerCount: number;
  shardTotal?: number | null;
  testCount: number;
  hookCount: number;
  waitCount: number;
  live?: boolean;
}>();

defineEmits<{ reset: [] }>();
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
    <UButton v-if="!live" size="xs" color="neutral" variant="ghost" icon="i-lucide-rotate-ccw" @click="$emit('reset')">
      Reset view
    </UButton>
  </div>
</template>
