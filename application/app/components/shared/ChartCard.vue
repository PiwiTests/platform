<script setup lang="ts">
/**
 * Thin wrapper over `SectionCard` for the `@unovis/vue` trend charts. Gives
 * every chart the standard header (icon / title / subtitle / help / actions)
 * plus an optional `legend` slot, so charts get headers and inline help like
 * every other block instead of ad-hoc `UCard + #header` markup.
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
}>();
</script>

<template>
  <SectionCard :title="title" :subtitle="subtitle" :icon="icon" :icon-class="iconClass" :help="help">
    <template v-if="$slots.subtitle" #subtitle>
      <slot name="subtitle" />
    </template>
    <template v-if="$slots.legend || $slots.actions" #actions>
      <slot name="legend" />
      <slot name="actions" />
    </template>
    <slot />
  </SectionCard>
</template>
