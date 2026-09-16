<script setup lang="ts">
/**
 * Thin wrapper over `SectionCard` for the SVG trend charts. Gives every chart
 * the standard header (icon / title / subtitle / help / actions) and renders the
 * `legend` there, so the color key reads as part of the heading instead of
 * costing a row under the plot.
 */
import type { HelpTopicKey } from '~/utils/help-content';

defineProps<{
  title: string;
  subtitle?: string;
  icon?: string;
  /** Tailwind color class for the header icon. */
  iconClass?: string;
  /** Inline-help topic rendered next to the title. */
  help?: HelpTopicKey;
  /** Color key for the plotted series, rendered in the header. */
  legend?: readonly { color: string; label: string }[];
}>();
</script>

<template>
  <SectionCard :title="title" :subtitle="subtitle" :icon="icon" :icon-class="iconClass" :help="help">
    <template v-if="$slots.subtitle" #subtitle>
      <slot name="subtitle" />
    </template>
    <template v-if="legend?.length || $slots.actions" #actions>
      <ChartLegend v-if="legend?.length" :items="legend" />
      <slot name="actions" />
    </template>
    <slot />
    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </SectionCard>
</template>
