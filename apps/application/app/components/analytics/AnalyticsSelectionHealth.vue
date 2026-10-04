<script setup lang="ts">
import type { AnalyticsProjectAnalysis } from '#shared/analytics/types';
import type { SelectionAnalytics } from '#shared/handlers/selection-analytics';

const props = defineProps<{ query: Record<string, string>; options?: Record<string, unknown>; title?: string }>();

const { data, pending, error, refresh } = await useAnalyticsWidget<AnalyticsProjectAnalysis<SelectionAnalytics>>(
  'selection-health',
  () => props.query,
);
</script>

<template>
  <SectionCard
    icon="i-lucide-list-filter"
    :title="title ?? 'Selection health'"
    :subtitle="data?.project?.name"
    help="analytics.selection-health"
  >
    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load selection health: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <EmptyState v-else-if="data && !data.project" icon="i-lucide-folder" :text="data.reason" />
    <template v-else-if="data?.project">
      <ul class="divide-y divide-default">
        <li v-for="sel in data.data.selections" :key="sel.key" class="py-2 min-w-0">
          <p class="text-sm text-highlighted break-words">
            {{ sel.name }} <span class="font-mono text-xs text-muted">{{ sel.key }}</span>
          </p>
          <p class="text-xs text-muted">
            {{ sel.resolvedCount }} {{ sel.resolvedCount === 1 ? 'test' : 'tests' }}
            <template v-if="sel.quarantinedCount"> · {{ sel.quarantinedCount }} quarantined</template>
            <template v-if="sel.warnings.length"> · {{ sel.warnings.length }} warnings</template>
            <template v-if="sel.drift?.changed"> · changed since its last run</template>
          </p>
        </li>
      </ul>
      <p class="text-xs text-muted mt-2">
        {{ data.data.coverage.unselected }} of {{ data.data.coverage.total }} tests are in no selection.
      </p>
    </template>
  </SectionCard>
</template>
