<script setup lang="ts">
/**
 * Compact UCard for the run summary grid tiles. Denser header than SectionCard:
 * a w-4 icon + text-sm title, with an optional smaller subtitle line below. Use
 * the `actions` slot for header-right controls and the default slot for the body.
 * The `subtitle` slot overrides the `subtitle` prop when richer markup is needed.
 *
 * Pass `help` (a registry topic key) to render an inline `HelpHint` beside the
 * title.
 */
import type { HelpTopicKey } from '~/utils/help-content';

withDefaults(
  defineProps<{
    title: string;
    icon?: string;
    subtitle?: string;
    /** Tailwind color class for the header icon. */
    iconClass?: string;
    /** Inline-help topic rendered next to the title. */
    help?: HelpTopicKey;
  }>(),
  { iconClass: 'text-primary' },
);
</script>

<template>
  <UCard class="shadow-xs" :ui="{ header: 'px-3 py-2.5 sm:px-3', body: 'p-3 sm:p-3' }">
    <template #header>
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <UIcon v-if="icon" :name="icon" class="w-4 h-4 shrink-0" :class="iconClass" />
          <div class="min-w-0">
            <span class="text-sm font-medium inline-flex items-center gap-1">
              {{ title }}<HelpHint v-if="help" :topic="help" />
            </span>
            <p v-if="subtitle || $slots.subtitle" class="text-xs text-gray-400 mt-0.5">
              <slot name="subtitle">{{ subtitle }}</slot>
            </p>
          </div>
        </div>
        <div v-if="$slots.actions" class="flex items-center gap-1 shrink-0">
          <slot name="actions" />
        </div>
      </div>
    </template>

    <slot />

    <template v-if="$slots.footer" #footer>
      <slot name="footer" />
    </template>
  </UCard>
</template>
