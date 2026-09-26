<script setup lang="ts">
import type { AnalyticsVerdict, VerdictTone } from '#shared/analytics/types';
import { sentencesFor } from '#shared/reports/sentences';

/**
 * The narrative widget on a page: the rule-based verdict, since the AI
 * narrative is written only for the scheduled quality reports that turn it on.
 */
const props = defineProps<{ query: Record<string, string>; title?: string }>();

const {
  data: verdict,
  pending,
  error,
  refresh,
} = await useAnalyticsWidget<AnalyticsVerdict>('narrative', () => props.query);

const sentence = computed(() =>
  verdict.value ? sentencesFor('en').verdict(verdict.value.facts, metricFormatter()) : '',
);

const TONE_DOT: Record<VerdictTone, string> = {
  good: PASS_RATE_TONES.good.bg,
  mixed: PASS_RATE_TONES.fair.bg,
  bad: PASS_RATE_TONES.poor.bg,
};
</script>

<template>
  <SectionCard
    icon="i-lucide-sparkles"
    :title="title ?? 'Narrative'"
    help="analytics.narrative"
    data-shot="analytics-narrative"
  >
    <LoadingState v-if="pending" />
    <ErrorState v-else-if="error" :text="`Couldn't load the narrative: ${errorMessage(error)}`">
      <template #action>
        <UButton size="sm" color="neutral" variant="outline" icon="i-lucide-refresh-cw" @click="refresh()">
          Retry
        </UButton>
      </template>
    </ErrorState>
    <div v-else-if="verdict" class="space-y-2">
      <div class="flex items-start gap-3">
        <span class="mt-1.5 size-2.5 shrink-0 rounded-full" :class="TONE_DOT[verdict.tone]" aria-hidden="true" />
        <p class="text-sm text-highlighted leading-relaxed" data-testid="narrative-sentence">{{ sentence }}</p>
      </div>
      <p class="text-xs text-muted">
        The rule-based verdict. A scheduled quality report with the AI narrative on puts three paragraphs written by the
        configured model here.
      </p>
    </div>
  </SectionCard>
</template>
