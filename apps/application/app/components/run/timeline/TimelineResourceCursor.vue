<script setup lang="ts">
/**
 * The moment the pointer is on in a resource band or a worker's strip, as a
 * line down the whole timeline, so a CPU or memory spike points at the tests
 * that ran then. Reads the shared hover state, so a pointer move redraws this
 * line and nothing else.
 */
import { TIMELINE_LAYOUT } from '~/utils/timeline';
import type { ResourceBand } from '~/utils/resource-tracks';

defineProps<{
  state: { band: ResourceBand | null; strip: object | null; t: number };
  pxPerMs: number;
  contentHeight: number;
}>();

const { labelWidth, axisHeight } = TIMELINE_LAYOUT;
</script>

<template>
  <line
    v-if="state.band || state.strip"
    :x1="labelWidth + state.t * pxPerMs"
    :x2="labelWidth + state.t * pxPerMs"
    :y1="axisHeight"
    :y2="contentHeight"
    stroke-dasharray="3 3"
    class="stroke-gray-400 dark:stroke-gray-500 pointer-events-none"
    data-testid="timeline-resource-cursor"
  />
</template>
