<script setup lang="ts">
import { useResizeObserver } from '@vueuse/core'

const config = useRuntimeConfig()
const bannerEl = useTemplateRef<HTMLElement>('banner')

if (config.public.demoMode) {
  useResizeObserver(bannerEl, (entries) => {
    const entry = entries[0]
    if (!entry) return
    document.documentElement.style.setProperty('--demo-banner-height', `${entry.contentRect.height}px`)
  })

  onUnmounted(() => {
    document.documentElement.style.removeProperty('--demo-banner-height')
  })
}
</script>

<template>
  <div v-if="config.public.demoMode" ref="banner" class="demo-banner">
    ⚠️ <strong>Demo mode</strong> — showing sample data only. Forms, actions, and file uploads are disabled. <a href="https://github.com/PhenX/piwi-dashboard" target="_blank" class="underline">Deploy your own instance</a> for live data.
  </div>
</template>

<style scoped>
.demo-banner {
  background-color: #fef3c7;
  color: #92400e;
  text-align: center;
  padding: 0.5rem 1rem 0.75rem;
  font-size: 0.875rem;
  font-weight: 500;
  border-bottom: 1px solid #fcd34d;
  margin-bottom: 0.25rem;
  position: relative;
  z-index: 60;
}

.dark .demo-banner {
  background-color: #451a03;
  color: #fcd34d;
  border-bottom-color: #78350f;
}
</style>
