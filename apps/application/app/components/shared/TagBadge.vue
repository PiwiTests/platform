<script setup lang="ts">
/**
 * A tag pill for a user-picked color (hex from the tag editor, but any CSS
 * color works). Styling is derived with CSS `color-mix`, so named colors
 * ("yellow", "blue") style the same way hex does.
 *
 * The look is GitHub-label-like: a soft tint of the color as background, a
 * translucent border, and the color itself pushed toward black (light mode)
 * or white (dark mode) for readable text whatever the base color is.
 */
defineProps<{
  text: string;
  color: string;
  variant?: 'solid' | 'outline';
}>();
</script>

<template>
  <span
    class="tag-badge inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
    :class="variant === 'outline' ? 'tag-badge--outline' : ''"
    :style="{ '--tag-color': color }"
  >
    {{ text }}
  </span>
</template>

<style scoped>
.tag-badge {
  background-color: color-mix(in srgb, var(--tag-color) 20%, transparent);
  border: 1px solid color-mix(in srgb, var(--tag-color) 60%, transparent);
  color: color-mix(in oklab, var(--tag-color) 80%, black);
}

:global(.dark) .tag-badge {
  color: color-mix(in oklab, var(--tag-color) 65%, white);
}

.tag-badge--outline {
  background-color: transparent;
}
</style>
