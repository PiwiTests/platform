<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core';

const config = useRuntimeConfig();
const bannerEl = useTemplateRef<HTMLElement>('banner');

if (config.public.demoMode) {
  useResizeObserver(bannerEl, (entries) => {
    const entry = entries[0];
    if (!entry) return;
    document.documentElement.style.setProperty('--demo-banner-height', `${entry.contentRect.height + 6}px`);
  });

  onUnmounted(() => {
    document.documentElement.style.removeProperty('--demo-banner-height');
  });
}
</script>

<template>
  <div v-if="config.public.demoMode" ref="banner" class="demo-banner">
    <div class="demo-banner-inner">
      <span>
        ⚠️ <strong>Demo mode</strong> — sample data running entirely in your browser.
        <a href="https://github.com/PhenX/piwi-dashboard" target="_blank" class="underline">Deploy your own instance</a>
        for live data.
      </span>
      <DemoSimulator />
    </div>
  </div>
</template>

<style scoped>
.demo-banner {
  background-color: #fef3c7;
  color: #92400e;
  text-align: center;
  padding: 0.375rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  border-bottom: 1px solid #fcd34d;
  position: relative;
  z-index: 60;
}

.demo-banner-inner {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 0.375rem 1rem;
}

.dark .demo-banner {
  background-color: #451a03;
  color: #fcd34d;
  border-bottom-color: #78350f;
}
</style>
