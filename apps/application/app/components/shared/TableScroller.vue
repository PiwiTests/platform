<script setup lang="ts">
/**
 * Horizontal-scroll wrapper for wide content (tables, charts, diffs) so it
 * scrolls in place instead of stretching the page on small screens. Optionally
 * bleeds to the card edge on mobile (`-mx-2.5`, matching the card body padding
 * below `sm`) for full-width swiping, and applies a `minWidth` to the inner
 * content so columns keep a readable width while the wrapper scrolls.
 *
 * Usage: `<TableScroller min-width="56rem"><UTable ... /></TableScroller>`
 */
withDefaults(
  defineProps<{
    /** Minimum width of the scrolled content, e.g. `'56rem'` or `'700px'`. */
    minWidth?: string;
    /** Bleed to the parent card edge below `sm` for edge-to-edge swiping. */
    bleed?: boolean;
  }>(),
  { bleed: true },
);
</script>

<template>
  <div class="overflow-x-auto" :class="bleed ? '-mx-2.5 px-2.5 sm:mx-0 sm:px-0' : ''">
    <div :style="minWidth ? { minWidth } : undefined">
      <slot />
    </div>
  </div>
</template>
