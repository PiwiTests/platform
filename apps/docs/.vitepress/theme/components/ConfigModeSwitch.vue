<script setup lang="ts">
import { withBase } from 'vitepress'

defineProps<{ mode: 'reference' | 'generator' }>()
</script>

<template>
  <nav class="config-mode-switch" aria-label="Configuration view">
    <a :href="withBase('/reference/configuration')" :class="{ active: mode === 'reference' }" :aria-current="mode === 'reference' ? 'page' : undefined">
      📖 Reference
    </a>
    <a :href="withBase('/reference/configuration/generator')" :class="{ active: mode === 'generator' }" :aria-current="mode === 'generator' ? 'page' : undefined">
      🧩 Generator
    </a>
  </nav>
</template>

<style scoped>
.config-mode-switch {
  display: inline-flex;
  gap: 4px;
  margin: 8px 0 4px;
  padding: 4px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
}
.config-mode-switch a {
  padding: 6px 14px;
  border-radius: 7px;
  font-size: 14px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.2s, background-color 0.2s;
}
.config-mode-switch a:hover {
  color: var(--vp-c-text-1);
}
.config-mode-switch a.active {
  background: var(--vp-c-bg);
  color: var(--vp-c-brand-1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
}
</style>
