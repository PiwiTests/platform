<script setup lang="ts">
/**
 * How often a cluster failed over the project's recent runs, as one inline bar
 * sparkline — magnitude over time, oldest → newest. One bar per run, the failure
 * colour for a run that failed and a muted baseline tick for a run it did not,
 * the latest run emphasized. No chart library and no axes. The sparkline is one
 * button, named by the summary sentence, that emits `open` (the page unfolds
 * Occurrences over time, its chart per day, week or month); each bar keeps a
 * `title` with its run number and count, and links to no run.
 *
 * SSR-safe: the server and the first client render agree (20 bars), and the
 * narrow-viewport slice to 12 bars only kicks in after mount.
 */
import type { OccurrenceSeriesPoint } from '~~/types/api';

const props = defineProps<{
  series: OccurrenceSeriesPoint[];
  /** The summary sentence, used as the control's accessible name. */
  label: string;
}>();

const emit = defineEmits<{ open: [] }>();

// At phone width the last 12 runs, otherwise the last 20 — matched after mount so
// the initial client render equals the SSR one.
const isNarrow = ref(false);
onMounted(() => {
  const mq = window.matchMedia('(max-width: 640px)');
  isNarrow.value = mq.matches;
  const onChange = (e: MediaQueryListEvent) => (isNarrow.value = e.matches);
  mq.addEventListener('change', onChange);
  onUnmounted(() => mq.removeEventListener('change', onChange));
});

const visible = computed(() => {
  const s = props.series ?? [];
  return s.slice(isNarrow.value ? -12 : -20);
});

// Geometry — fixed pixel bars, so the chart is exactly as wide as it needs to be
// and never stretches. The drawing area is `H` tall; bars grow from the baseline.
const STEP = 9;
const BAR_W = 6;
const H = 34;
const maxCount = computed(() => Math.max(1, ...visible.value.map((p) => p.occurrences)));
const width = computed(() => Math.max(STEP, visible.value.length * STEP));

interface Bar {
  runId: number;
  occurrences: number;
  x: number;
  y: number;
  h: number;
  zero: boolean;
  latest: boolean;
  title: string;
}

const bars = computed<Bar[]>(() => {
  const list = visible.value;
  const lastIndex = list.length - 1;
  return list.map((p, i) => {
    const zero = p.occurrences <= 0;
    const h = zero ? 2 : Math.max(3, Math.round((p.occurrences / maxCount.value) * (H - 4)));
    return {
      runId: p.runId,
      occurrences: p.occurrences,
      x: i * STEP,
      y: H - h,
      h,
      zero,
      latest: i === lastIndex,
      title: zero
        ? `run #${p.runId}: no occurrences`
        : `run #${p.runId}: ${p.occurrences} occurrence${p.occurrences === 1 ? '' : 's'}`,
    };
  });
});
</script>

<template>
  <button
    v-if="bars.length"
    type="button"
    class="shrink-0 rounded-sm outline-none focus-visible:outline-2 focus-visible:outline-primary"
    :aria-label="`${label}. Show occurrences over time`"
    @click="emit('open')"
  >
    <svg
      data-shot="occurrence-sparkline"
      aria-hidden="true"
      :width="width"
      :height="H"
      :viewBox="`0 0 ${width} ${H}`"
      class="block overflow-visible"
    >
      <!-- A run that failed: a coloured bar; a run it did not occur in: a muted baseline tick. -->
      <rect
        v-for="bar in bars"
        :key="bar.runId"
        :x="bar.x"
        :y="bar.y"
        :width="BAR_W"
        :height="bar.h"
        :rx="bar.zero ? 1 : 1.5"
        fill="currentColor"
        :class="bar.zero ? 'text-muted/50' : bar.latest ? 'text-error' : 'text-error/60'"
      >
        <title>{{ bar.title }}</title>
      </rect>
    </svg>
  </button>
</template>
