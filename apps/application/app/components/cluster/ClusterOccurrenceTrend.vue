<script setup lang="ts">
/**
 * A failure cluster's occurrences over time: its failing executions per
 * bucket over a chosen span, with the moment its fix landed and, when the fix
 * did not hold, its first occurrence after it — "did my fix hold", at a glance.
 */
import type { ClusterOccurrenceTrend } from '#shared/handlers/failure-clusters';
import type { TrendLine } from '~/utils/chart';

const props = defineProps<{ clusterId: number }>();

const SPANS = [
  { label: 'Last 30 days', value: 30 },
  { label: 'Last 90 days', value: 90 },
  { label: 'Last 365 days', value: 365 },
];
const days = ref(90);
const trend = ref<ClusterOccurrenceTrend | null>(null);
const pending = ref(false);
const error = ref<unknown>(null);

async function load() {
  pending.value = true;
  error.value = null;
  try {
    trend.value = await $fetch<ClusterOccurrenceTrend>(`/api/failure-clusters/${props.clusterId}/occurrence-trend`, {
      query: { days: days.value },
    });
  } catch (e) {
    error.value = e;
  } finally {
    pending.value = false;
  }
}
watch([() => props.clusterId, days], load, { immediate: true });

const buckets = computed(() => trend.value?.buckets ?? []);
const hasData = computed(() => buckets.value.some((b) => b.occurrences > 0) || !!trend.value?.fixLandedAt);
const lines = computed<TrendLine[]>(() => [
  {
    label: 'Occurrences',
    color: STATUS_PALETTE.failed.color,
    points: buckets.value.map((b) => ({ date: b.date, value: b.occurrences })),
  },
  {
    label: 'Tests failing',
    color: STATUS_PALETTE.failed.color,
    dashed: true,
    points: buckets.value.map((b) => ({ date: b.date, value: b.tests })),
  },
]);
const marks = computed(() => {
  const t = trend.value;
  const out: Array<{ date: string; label: string; color: string }> = [];
  if (t?.fixLandedAt) out.push({ date: t.fixLandedAt, label: 'Fix landed', color: STATUS_PALETTE.passed.color });
  if (t?.regressedAt)
    out.push({ date: t.regressedAt, label: 'Failed again after the fix', color: STATUS_PALETTE.failed.color });
  return out;
});
const legend = computed(() => [
  { color: STATUS_PALETTE.failed.color, label: 'Occurrences' },
  ...(trend.value?.fixLandedAt ? [{ color: STATUS_PALETTE.passed.color, label: 'Fix landed' }] : []),
]);
const subtitle = computed(() => {
  const t = trend.value;
  if (!t) return undefined;
  const total = t.buckets.reduce((n, b) => n + b.occurrences, 0);
  if (t.regressedAt) return `${total} occurrences · failed again after its fix`;
  if (t.fixLandedAt) return `${total} occurrences · no occurrence since its fix`;
  return `${total} occurrences`;
});
const exportData = computed(() => ({
  name: `failure-cluster-${props.clusterId}-occurrences`,
  header: ['date', 'occurrences', 'tests failing'],
  rows: buckets.value.map((b) => [b.date, b.occurrences, b.tests]),
}));
</script>

<template>
  <ChartCard
    title="Occurrences over time"
    icon="i-lucide-chart-line"
    :subtitle="subtitle"
    help="cluster.occurrence-trend"
    :legend="legend"
    :export-data="exportData"
    data-shot="cluster-occurrence-trend"
  >
    <template #actions>
      <USelect
        v-model="days"
        :items="SPANS"
        value-key="value"
        size="xs"
        aria-label="Occurrence trend span"
        data-testid="cluster-trend-span"
      />
    </template>
    <LoadingState v-if="pending && !trend" />
    <ErrorState v-else-if="error" :text="`Couldn't load the occurrences: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="load()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="!hasData" text="No occurrence in this span." />
    <TrendLinesChart
      v-else
      :series="lines"
      :height="170"
      :marks="marks"
      :markers="false"
      :class="pending ? 'opacity-60' : ''"
    />
  </ChartCard>
</template>
