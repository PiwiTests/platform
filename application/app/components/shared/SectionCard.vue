<script setup lang="ts">
/**
 * UCard with a standard header: optional icon, title, optional `(count)` and an
 * optional subtitle/description line. Use the `actions` slot for header-right
 * controls (badge, button) and the default slot for the body. `subtitle` slot
 * overrides the `subtitle` prop when richer markup is needed.
 *
 * Pass `help` (a registry topic key) to render an inline `HelpHint` beside the
 * title — the standard way to document a non-self-explanatory block.
 */
import type { HelpTopicKey } from '~/utils/help-content';

withDefaults(
  defineProps<{
    title: string;
    icon?: string;
    subtitle?: string;
    count?: number | null;
    /** Tailwind color class for the header icon. */
    iconClass?: string;
    /** Inline-help topic rendered next to the title. */
    help?: HelpTopicKey;
  }>(),
  { iconClass: 'text-primary' },
);
</script>

<template>
  <UCard>
    <template #header>
      <div class="flex items-start justify-between gap-2">
        <div class="flex items-center gap-2 min-w-0">
          <UIcon v-if="icon" :name="icon" class="w-5 h-5 shrink-0" :class="iconClass" />
          <div class="min-w-0">
            <h3 class="text-lg font-medium inline-flex items-center gap-1">
              {{ title }}<template v-if="count != null"> ({{ count }})</template>
              <HelpHint v-if="help" :topic="help" />
            </h3>
            <p v-if="subtitle || $slots.subtitle" class="text-sm text-gray-500 mt-0.5">
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
