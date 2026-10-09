<script setup lang="ts">
import { orderedStepParams } from '@piwitests/core/step-analysis';

/**
 * A step's curated params as a key/value list under a meta label: the rendered
 * `locator` first, then a navigation's URL, an action's value/button, or a
 * `test.step` author's own values. The timeline shows it when the step's row
 * is opened; nothing shows when the step carried no params (1.61, or an API
 * step Playwright gave none).
 */
const props = defineProps<{ params?: Record<string, string | number | boolean> | null }>();

const entries = computed(() => orderedStepParams(props.params));
</script>

<template>
  <div v-if="entries.length > 0" class="text-xs" data-testid="step-params">
    <p class="text-muted">Parameters ({{ entries.length }})</p>
    <dl class="mt-0.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5">
      <template v-for="[key, value] in entries" :key="key">
        <dt class="font-mono text-muted">{{ key }}</dt>
        <dd class="break-all font-mono text-default">{{ value }}</dd>
      </template>
    </dl>
  </div>
</template>
