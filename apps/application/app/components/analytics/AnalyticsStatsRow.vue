<script setup lang="ts">
import type { AnalyticsStats } from '#shared/analytics/types';

const props = defineProps<{ query: Record<string, string>; options?: Record<string, unknown>; title?: string }>();

const {
  data: stats,
  pending,
  error,
  refresh,
} = await useAnalyticsWidget<AnalyticsStats>(
  'stats',
  () => props.query,
  () => props.options,
);

const f = computed(() => metricFormatter());
</script>

<template>
  <section data-shot="analytics-headline" :aria-label="title ?? 'Headline numbers'" class="space-y-1">
    <div class="flex items-center gap-1">
      <h3 class="text-xs font-medium text-muted">{{ title ?? 'Headline numbers' }}</h3>
      <HelpHint topic="analytics.stats" />
      <span v-if="stats?.comparisonLabel" class="text-xs text-muted"
        >· vs {{ stats.comparisonLabel.toLowerCase() }}</span
      >
    </div>
    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load the headline numbers: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <StatTileGrid v-else-if="stats">
      <StatTile
        v-for="tile in stats.tiles"
        :key="tile.metric"
        :label="tile.label"
        :value="formatMetric(tile, f)"
        :value-class="metricValueClass(tile)"
        :title="tile.definition"
        :data-testid="`stat-${tile.metric}`"
      >
        <template #hint>
          <span v-if="f.delta(tile)" :class="metricTrendClass(tile.trend)">{{ f.delta(tile) }}</span>
          <span v-if="tile.companion">
            <template v-if="f.delta(tile)"> · </template
            >{{ tile.companion.unit === 'money' ? '' : `${tile.companion.label}: `
            }}{{ formatMetric(tile.companion, f) }}
          </span>
        </template>
      </StatTile>
    </StatTileGrid>
  </section>
</template>
