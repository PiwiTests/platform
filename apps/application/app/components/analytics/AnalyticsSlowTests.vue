<script setup lang="ts">
import type { AnalyticsProjectAnalysis } from '#shared/analytics/types';
import type { SlowTestsData } from '#shared/handlers/analytics/project-analyses';

const props = defineProps<{ query: Record<string, string>; options?: Record<string, unknown>; title?: string }>();

const { data, pending, error, refresh } = await useAnalyticsWidget<AnalyticsProjectAnalysis<SlowTestsData>>(
  'slow-tests',
  () => props.query,
  () => props.options,
);
</script>

<template>
  <SectionCard
    icon="i-lucide-snail"
    :title="title ?? 'Slowest tests'"
    :subtitle="data?.project?.name"
    help="analytics.slow-tests"
  >
    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load the slowest tests: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="data && !data.project" icon="i-lucide-folder" :text="data.reason" />
    <EmptyState v-else-if="!data?.project || data.data.length === 0" text="No execution in the recent runs." />
    <ul v-else class="divide-y divide-default">
      <li v-for="t in data.data" :key="t.id" class="py-2 flex items-baseline justify-between gap-3 min-w-0">
        <div class="min-w-0">
          <NuxtLink
            :to="`/test-cases/${t.id}`"
            class="text-sm text-highlighted break-words underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {{ t.title }}
          </NuxtLink>
          <p class="text-xs text-muted font-mono break-all">{{ t.filePath }}</p>
        </div>
        <DurationValue class="shrink-0 text-sm tabular-nums" :ms="t.avgDuration" />
      </li>
    </ul>
  </SectionCard>
</template>
