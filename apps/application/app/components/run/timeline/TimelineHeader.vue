<script setup lang="ts">
defineProps<{
  workerCount: number;
  shardTotal?: number | null;
  testCount: number;
  /** Hook sections that failed — drawn whatever the hooks toggle says. */
  hookFailureCount: number;
  waitCount: number;
  /** Times a lane's worker process was replaced by a new one. */
  restartCount?: number;
  /** Whether the run has any hook sections to show. */
  hasHooks: boolean;
  /** Current state of the hooks toggle. */
  showHooks: boolean;
  /** Current state of the wasted-waits toggle. */
  showWaits: boolean;
  /** Whether the run declared any locks (best effort). */
  hasLocks?: boolean;
  /** Current state of the lock toggle. */
  showLocks?: boolean;
  /** Distinct lock names in the run. */
  lockCount?: number;
  /** How many test rows are currently expanded into their step waterfall. */
  expandedCount?: number;
  live?: boolean;
}>();

defineEmits<{
  reset: [];
  toggleHooks: [visible: boolean];
  toggleWaits: [visible: boolean];
  toggleLocks: [visible: boolean];
  collapseAll: [];
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
        <template v-if="hookFailureCount > 0">
          &middot;
          <span class="text-error" data-testid="timeline-hook-failures"
            >{{ hookFailureCount }} hook failure{{ hookFailureCount > 1 ? 's' : '' }}</span
          >
        </template>
        <template v-if="waitCount > 0"> &middot; {{ waitCount }} waits </template>
        <template v-if="restartCount && restartCount > 0">
          &middot; {{ restartCount }} worker restart{{ restartCount > 1 ? 's' : '' }}
        </template>
        <template v-if="lockCount && lockCount > 0">
          &middot; {{ lockCount }} lock{{ lockCount > 1 ? 's' : '' }}
        </template></span
      >
      <HelpHint topic="run.timeline" />
    </span>
    <div class="flex items-center gap-1">
      <UButton
        v-if="expandedCount && expandedCount > 0"
        size="xs"
        color="neutral"
        variant="ghost"
        icon="i-lucide-chevrons-down-up"
        @click="$emit('collapseAll')"
      >
        Collapse steps ({{ expandedCount }})
      </UButton>
      <USwitch
        v-if="hasHooks"
        :model-value="showHooks"
        label="Show hooks"
        size="xs"
        class="mr-1"
        @update:model-value="$emit('toggleHooks', $event === true)"
      />
      <USwitch
        v-if="waitCount > 0"
        :model-value="showWaits"
        label="Show waits"
        size="xs"
        class="mr-1"
        @update:model-value="$emit('toggleWaits', $event === true)"
      />
      <USwitch
        v-if="hasLocks"
        :model-value="showLocks"
        label="Show locks"
        size="xs"
        class="mr-1"
        @update:model-value="$emit('toggleLocks', $event === true)"
      />

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
