<script setup lang="ts">
import { orderedStepParams } from '@piwitests/core/step-analysis';

/**
 * A step's curated params as an on-demand key/value list: the rendered
 * `locator` first, then a navigation's URL, an action's value/button, or a
 * `test.step` author's own values. Collapsed by default and rendered as a
 * native disclosure so it works without script; nothing shows when the step
 * carried no params (1.61, or an API step Playwright gave none).
 */
const props = defineProps<{ params?: Record<string, string | number | boolean> | null }>();

const entries = computed(() => orderedStepParams(props.params));
</script>

<template>
  <details v-if="entries.length > 0" class="group text-xs" data-testid="step-params">
    <summary
      class="inline-flex cursor-pointer select-none items-center gap-1 text-gray-500 hover:text-gray-700 dark:text-gray-400 dark:hover:text-gray-200"
    >
      <UIcon name="i-lucide-chevron-right" class="size-3 transition-transform group-open:rotate-90" />
      Parameters ({{ entries.length }})
    </summary>
    <dl class="mt-1 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      <template v-for="[key, value] in entries" :key="key">
        <dt class="font-mono text-gray-500 dark:text-gray-400">{{ key }}</dt>
        <dd class="break-all font-mono text-gray-700 dark:text-gray-300">{{ value }}</dd>
      </template>
    </dl>
  </details>
</template>
