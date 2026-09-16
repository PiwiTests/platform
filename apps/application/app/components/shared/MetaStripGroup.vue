<script setup lang="ts">
/**
 * One fact group inside a `SummaryMetaStrip`: an optional muted icon, inline
 * content, and a hairline divider before every group but the first. `label`
 * names the group on hover and for assistive tech.
 */
import type { HelpTopicKey } from '~/utils/help-content';

defineProps<{
  label: string;
  icon?: string;
  /** Inline-help topic rendered after the group content. */
  help?: HelpTopicKey;
}>();
</script>

<template>
  <div
    role="group"
    :aria-label="label"
    class="inline-flex items-center flex-wrap gap-x-1.5 gap-y-1 min-w-0 py-0.5 mr-3 [&:not(:first-child)]:border-l [&:not(:first-child)]:border-default [&:not(:first-child)]:pl-3"
  >
    <UIcon v-if="icon" :name="icon" class="w-3.5 h-3.5 text-dimmed shrink-0" />
    <slot />
    <HelpHint v-if="help" :topic="help" />
  </div>
</template>
