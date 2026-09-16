<script setup lang="ts">
import { stepLabelParts } from '@piwitests/core/step-analysis';

/**
 * A step's label as two elements: the title, then its target (the rendered
 * locator or URL) in a muted secondary style, shown only when newer Playwright
 * carried it in a separate `subtitle`. A 1.61 step, whose title already spells
 * out the target, renders as the title alone. The joined plain-text form lives
 * in {@link stepLabel} for copy actions, tooltips and the AI context.
 */
const props = defineProps<{ step: { title?: string | null; subtitle?: string | null } }>();

const parts = computed(() => stepLabelParts(props.step));
</script>

<template>
  <span
    >{{ parts.title
    }}<span v-if="parts.subtitle" class="ml-1.5 font-normal text-gray-500 dark:text-gray-400">{{
      parts.subtitle
    }}</span></span
  >
</template>
