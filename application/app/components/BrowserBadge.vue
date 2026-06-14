<script setup lang="ts">
import type { BrowserConfig } from '~~/shared/types';

const props = defineProps<{
  browser: BrowserConfig | null | undefined;
  size?: 'sm' | 'md' | 'lg';
}>();

const name = computed(() => props.browser?.projectName ?? null);
const icon = computed(() => getBrowserIcon(name.value));
const hexColor = computed(() => getBrowserHexColor(name.value));

const tooltipLines = computed(() => {
  const b = props.browser;
  if (!b) return [];
  const lines: string[] = [];
  if (b.browserName && b.browserName !== name.value) lines.push(`Browser: ${b.browserName}`);
  if (b.channel) lines.push(`Channel: ${b.channel}`);
  if (b.viewport) lines.push(`Viewport: ${b.viewport.width}×${b.viewport.height}`);
  if (b.deviceScaleFactor && b.deviceScaleFactor !== 1) lines.push(`Scale: ${b.deviceScaleFactor}x`);
  if (b.isMobile) lines.push('Mobile');
  if (b.hasTouch && !b.isMobile) lines.push('Touch');
  if (b.locale) lines.push(`Locale: ${b.locale}`);
  if (b.timezoneId) lines.push(`TZ: ${b.timezoneId}`);
  if (b.colorScheme && b.colorScheme !== 'light') lines.push(`Color: ${b.colorScheme}`);
  if (b.reducedMotion && b.reducedMotion !== 'no-preference') lines.push(`Motion: ${b.reducedMotion}`);
  if (b.forcedColors && b.forcedColors !== 'none') lines.push(`Colors: forced`);
  if (b.offline) lines.push('Offline');
  if (b.bypassCSP) lines.push('CSP bypassed');
  if (b.javaScriptEnabled === false) lines.push('JS disabled');
  if (b.serviceWorkers === 'block') lines.push('SW blocked');
  if (b.geolocation) lines.push(`Geo: ${b.geolocation.latitude.toFixed(2)},${b.geolocation.longitude.toFixed(2)}`);
  if (b.userAgent) lines.push(`UA: ${b.userAgent.length > 60 ? b.userAgent.slice(0, 60) + '…' : b.userAgent}`);
  return lines;
});

function hexToRgba(hex: string, alpha: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${alpha})`;
}
</script>

<template>
  <UTooltip v-if="name && tooltipLines.length" :text="tooltipLines.join(' · ')" :popper="{ placement: 'top' }">
    <span
      class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium font-mono capitalize gap-1 cursor-help whitespace-nowrap"
      :style="{
        color: hexColor,
        backgroundColor: hexToRgba(hexColor, 0.12),
        border: `1px solid ${hexToRgba(hexColor, 0.3)}`,
      }"
    >
      <UIcon :name="icon" class="shrink-0" :class="size === 'sm' ? 'size-3' : size === 'lg' ? 'size-4' : 'size-3.5'" />
      {{ name }}
    </span>
  </UTooltip>
  <span
    v-else-if="name"
    class="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium font-mono capitalize gap-1 whitespace-nowrap"
    :style="{
      color: hexColor,
      backgroundColor: hexToRgba(hexColor, 0.12),
      border: `1px solid ${hexToRgba(hexColor, 0.3)}`,
    }"
  >
    <UIcon :name="icon" class="shrink-0" :class="size === 'sm' ? 'size-3' : size === 'lg' ? 'size-4' : 'size-3.5'" />
    {{ name }}
  </span>
  <span v-else class="text-xs text-gray-400 dark:text-gray-500 italic">—</span>
</template>
