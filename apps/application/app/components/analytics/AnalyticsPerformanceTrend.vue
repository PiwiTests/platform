<script setup lang="ts">
import type { AnalyticsProjectAnalysis } from '#shared/analytics/types';
import type { PerformanceTrendData } from '#shared/handlers/analytics/project-analyses';
import type { PerformanceTrendPoint } from '~~/types/api';
import { RUN_DURATION_SERIES, legendOf } from '~/utils/chart';

const props = defineProps<{ query: Record<string, string>; options?: Record<string, unknown>; title?: string }>();

const { data, pending, error, refresh } = await useAnalyticsWidget<AnalyticsProjectAnalysis<PerformanceTrendData>>(
  'performance-trend',
  () => props.query,
);
const points = computed(() => (data.value?.project ? (data.value.data as unknown as PerformanceTrendPoint[]) : []));
const exportData = computed(() => ({
  name: 'performance-trend',
  header: ['run', 'started at', 'duration ms', 'average test ms', 'p90 test ms'],
  rows: points.value.map((p) => [
    p.id,
    new Date(p.startTime).toISOString(),
    p.duration ?? null,
    p.avgTestDuration ?? null,
    p.p90TestDuration ?? null,
  ]),
}));
</script>

<template>
  <ChartCard
    icon="i-lucide-trending-up"
    :title="title ?? 'Performance trend'"
    :subtitle="data?.project?.name"
    :legend="legendOf(RUN_DURATION_SERIES)"
    help="analytics.performance-trend"
    :export-data="exportData"
  >
    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load the performance trend: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="data && !data.project" icon="i-lucide-folder" :text="data.reason" />
    <EmptyState v-else-if="points.length === 0" text="No run in this period." />
    <PerformanceTrendChart v-else :data="points" />
  </ChartCard>
</template>
