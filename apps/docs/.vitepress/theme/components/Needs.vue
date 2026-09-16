<script setup lang="ts">
/**
 * The prerequisite row for a feature page — a reader sees what a feature needs
 * before the first paragraph, the way the recipes spell it out in prose. Each
 * boolean prop is one prerequisite chip; declare exactly what the feature needs:
 *
 *   <Needs reporter fixtures />
 *   <Needs desktop />
 *
 * The chips and their order match the feature catalog
 * (apps/application/shared/piwi-features.ts) that generates the feature map.
 */
const props = defineProps<{
  reporter?: boolean
  fixtures?: boolean
  llm?: boolean
  scm?: boolean
  desktop?: boolean
  extension?: boolean
  admin?: boolean
}>()

// Fixed order so every page reads the same way, baseline first.
const CHIPS: { key: keyof typeof props; label: string }[] = [
  { key: 'reporter', label: 'Reporter' },
  { key: 'fixtures', label: 'Capture fixtures' },
  { key: 'llm', label: 'AI key' },
  { key: 'scm', label: 'SCM token' },
  { key: 'desktop', label: 'Desktop app' },
  { key: 'extension', label: 'Browser extension' },
  { key: 'admin', label: 'Admin' },
]

const active = CHIPS.filter((c) => props[c.key])
</script>

<template>
  <p class="needs" aria-label="Prerequisites">
    <span class="needs-label">Needs</span>
    <span v-for="chip in active" :key="chip.key" class="needs-chip">{{ chip.label }}</span>
  </p>
</template>

<style scoped>
.needs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 6px;
  margin: 0 0 20px;
}
.needs-label {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: var(--vp-c-text-3);
  margin-right: 2px;
}
.needs-chip {
  padding: 2px 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  font-size: 13px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}
</style>
