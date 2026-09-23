<script setup lang="ts">
/**
 * A toggle chip that filters a test list by one outcome: a dot (or an icon) in
 * the outcome's palette color, tinted in that color while pressed.
 */
const props = defineProps<{
  status: StatusPaletteKey;
  label: string;
  pressed: boolean;
  /** Replaces the dot, for a signal chip such as "New regressions". */
  icon?: string;
}>();

const palette = computed(() => STATUS_PALETTE[props.status]);
</script>

<template>
  <button
    type="button"
    class="inline-flex items-center gap-1.5 px-2 py-1 rounded-md text-xs font-medium transition-colors whitespace-nowrap"
    :class="
      pressed
        ? palette.chip
        : 'bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400 hover:bg-zinc-200 dark:hover:bg-zinc-700'
    "
    :aria-pressed="pressed"
  >
    <UIcon v-if="icon" :name="icon" class="size-3 shrink-0" />
    <span v-else class="size-2 rounded-full shrink-0" :class="palette.bg" />
    {{ label }}
  </button>
</template>
