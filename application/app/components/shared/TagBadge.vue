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

function contrastColor(hex: string): string {
  const toLinear = (c: number) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  const r = toLinear(parseInt(hex.slice(1, 3), 16));
  const g = toLinear(parseInt(hex.slice(3, 5), 16));
  const b = toLinear(parseInt(hex.slice(5, 7), 16));
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  return luminance > 0.179 ? '#1a1a1a' : '#ffffff';
}
</script>

<template>
  <span
    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap"
    :style="
      variant === 'outline'
        ? { border: `1px solid ${color}`, color, backgroundColor: hexToRgba(color, 0.08) }
        : { backgroundColor: color, color: contrastColor(color) }
    "
  >
    {{ text }}
  </span>
</template>
