<script setup lang="ts">
/**
 * Single stat tile — small uppercase label above a value, with an optional
 * hint line below. Standardizes the ad-hoc `bg-gray-50 dark:bg-gray-900`
 * tiles used across detail pages. Place inside a `StatTileGrid`. The default
 * slot overrides `value` and the `label` slot overrides `label` when richer
 * markup (e.g. a `HelpHint`) is needed.
 */
withDefaults(
  defineProps<{
    label: string;
    value?: string | number | null;
    /** Small muted line under the value. */
    hint?: string;
    /** `lg` = prominent number (text-xl bold), `sm` = compact text value. */
    size?: 'sm' | 'lg';
    /** Extra classes for the value line (e.g. a status color). */
    valueClass?: string;
  }>(),
  { size: 'lg', valueClass: '' },
);
</script>

<template>
  <div class="rounded-lg bg-gray-50 dark:bg-gray-900 p-2.5 sm:p-3 min-w-0">
    <p class="text-xs font-medium text-gray-500 uppercase tracking-wider inline-flex items-center gap-1 max-w-full">
      <slot name="label">{{ label }}</slot>
    </p>
    <p class="mt-0.5 break-words" :class="[size === 'lg' ? 'text-xl font-bold' : 'text-sm font-semibold', valueClass]">
      <slot>{{ value ?? '—' }}</slot>
    </p>
    <p v-if="hint" class="text-xs text-gray-400 mt-1">{{ hint }}</p>
  </div>
</template>
