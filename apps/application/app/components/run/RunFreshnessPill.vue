<script setup lang="ts">
/**
 * "Latest run" / "Newer run → #N" / "Running → #N" pill shown beside a run's
 * identity. A link when a newer run exists (or one is streaming), a static
 * badge when this run is already the latest.
 */
defineProps<{
  latestRunId: number | null;
  currentRunId: number;
  isActive: boolean;
}>();
</script>

<template>
  <NuxtLink
    v-if="latestRunId && latestRunId !== currentRunId"
    :to="`/test-runs/${latestRunId}`"
    :aria-label="isActive ? `Go to running run #${latestRunId}` : `Go to latest run #${latestRunId}`"
    class="shrink-0 inline-flex items-center gap-1 rounded-full bg-blue-500/10 hover:bg-blue-500/20 transition-colors px-2 py-0.5 text-xs text-blue-500"
  >
    <UIcon name="i-lucide-circle-play" class="size-3.5" :class="{ 'animate-pulse': isActive }" />
    {{ isActive ? 'Running' : 'Newer run' }} → #{{ latestRunId }}
  </NuxtLink>
  <span
    v-else-if="latestRunId"
    class="shrink-0 inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs text-emerald-600 dark:text-emerald-400"
  >
    <UIcon name="i-lucide-check-circle-2" class="size-3.5" />
    Latest run
  </span>
</template>
