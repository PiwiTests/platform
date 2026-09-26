<script setup lang="ts">
import type { AnalyticsProjectAnalysis } from '#shared/analytics/types';
import type { TimeoutOpportunity } from '#shared/analytics/timeout-hygiene';

const props = defineProps<{ query: Record<string, string>; options?: Record<string, unknown>; title?: string }>();

const { data, pending, error, refresh } = await useAnalyticsWidget<AnalyticsProjectAnalysis<TimeoutOpportunity[]>>(
  'timeout-opportunities',
  () => props.query,
  () => props.options,
);
</script>

<template>
  <SectionCard
    icon="i-lucide-alarm-clock"
    :title="title ?? 'Timeout opportunities'"
    :subtitle="data?.project?.name"
    help="analytics.timeout-opportunities"
  >
    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load the timeout opportunities: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="data && !data.project" icon="i-lucide-folder" :text="data.reason" />
    <EmptyState
      v-else-if="!data?.project || data.data.length === 0"
      icon="i-lucide-check-circle"
      text="Every timeout fits its test."
    />
    <ul v-else class="divide-y divide-default">
      <li v-for="t in data.data" :key="t.testCaseId" class="py-2 min-w-0">
        <NuxtLink
          :to="`/test-cases/${t.testCaseId}`"
          class="text-sm text-highlighted break-words underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          {{ t.title }}
        </NuxtLink>
        <p class="text-xs text-muted">
          p95 <DurationValue :ms="t.p95" />
          <template v-if="t.timeout !== null"> · timeout <DurationValue :ms="t.timeout" /></template>
          <template v-if="t.recommendedTimeout !== null">
            · suggested <DurationValue :ms="t.recommendedTimeout"
          /></template>
          <template v-else> · remove test.slow()</template>
        </p>
      </li>
    </ul>
  </SectionCard>
</template>
