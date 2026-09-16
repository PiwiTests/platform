<script setup lang="ts">
import { stepLabel, stepLabelParts } from '@piwitests/core/step-analysis';
import type { LiveStepInfo } from '~/utils/live-steps';

/**
 * The step a running test is executing right now, shown inline on its row.
 * Replaces the bare "In progress..." placeholder while step events stream in;
 * the outcome icon lingers on the last step until the next one begins.
 */
const props = defineProps<{ step: LiveStepInfo }>();

// The title reads first; the target (locator or URL) follows in a muted style
// after a middot — `Click · getByRole(…)`. `label` stays the joined plain text
// for the truncation tooltip.
const parts = computed(() => stepLabelParts(props.step));
const label = computed(() => stepLabel(props.step));
</script>

<template>
  <span class="inline-flex items-center gap-1 min-w-0 text-xs text-info" data-testid="live-step">
    <UIcon
      v-if="step.status"
      :name="step.status === 'failed' ? 'i-lucide-x' : 'i-lucide-check'"
      :class="step.status === 'failed' ? 'text-rose-500' : 'text-emerald-500'"
      class="size-3 shrink-0"
    />
    <UIcon v-else name="i-lucide-loader-circle" class="size-3 shrink-0 animate-spin" />
    <span class="truncate" :title="label">
      {{ parts.title }}<span v-if="parts.subtitle" class="text-info/60"> · {{ parts.subtitle }}</span>
    </span>
  </span>
</template>
