<script setup lang="ts">
defineProps<{
  text: string;
  color: string;
  variant?: 'solid' | 'outline';
}>();

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
    :style="
      variant === 'outline'
        ? { border: `1px solid ${color}`, color, backgroundColor: hexToRgba(color, 0.08) }
        : { backgroundColor: hexToRgba(color, 0.18), color, border: `1px solid ${hexToRgba(color, 0.4)}` }
    "
  >
    {{ text }}
  </span>
</template>
