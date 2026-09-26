<script setup lang="ts">
/**
 * The run's one count bar: a proportional stacked bar with the counts on
 * clickable segments. Each segment is a filter — clicking it toggles that
 * status in the Tests tab's filter set and switches to the Tests tab. Zero-count
 * segments are hidden. Flaky (passed on retry) is a subset of passed, so it is
 * subtracted from the passed segment to avoid double-counting; fixme is a
 * subset of skipped the same way, drawn in the second grey.
 */
const props = defineProps<{
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
  /** `test.fixme()` skips — a subset of `skipped`. */
  fixme?: number;
  didNotRun: number;
  total: number;
  /** The status filters currently active, shared with the Tests tab chips. */
  activeStatuses: string[];
}>();

const emit = defineEmits<{ 'toggle-status': [status: string] }>();

interface Segment {
  key: string;
  status: string;
  label: string;
  count: number;
  palette: StatusPaletteEntry;
}

const segments = computed<Segment[]>(() => {
  const passedOnly = Math.max(0, props.passed - props.flaky);
  const fixme = Math.min(props.fixme ?? 0, props.skipped);
  return (
    [
      { key: 'passed', status: 'passed', label: 'passed', count: passedOnly, palette: STATUS_PALETTE.passed },
      { key: 'failed', status: 'failed', label: 'failed', count: props.failed, palette: STATUS_PALETTE.failed },
      { key: 'flaky', status: 'flaky', label: 'passed on retry', count: props.flaky, palette: STATUS_PALETTE.flaky },
      {
        key: 'skipped',
        status: 'skipped',
        label: 'skipped',
        count: props.skipped - fixme,
        palette: STATUS_PALETTE.skipped,
      },
      { key: 'fixme', status: 'fixme', label: 'fixme', count: fixme, palette: STATUS_PALETTE.fixme },
      {
        key: 'didnotrun',
        status: 'didnotrun',
        label: "didn't run",
        count: props.didNotRun,
        palette: STATUS_PALETTE.didnotrun,
      },
    ] satisfies Segment[]
  ).filter((s) => s.count > 0);
});

function isActive(status: string): boolean {
  return props.activeStatuses.includes(status);
}
</script>

<template>
  <div v-if="total > 0" class="space-y-1.5">
    <div class="flex gap-0.5 h-2.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-700">
      <button
        v-for="seg in segments"
        :key="seg.key"
        type="button"
        class="h-full transition-all cursor-pointer"
        :class="[seg.palette.bg, isActive(seg.status) ? ['ring-2', seg.palette.ring] : '']"
        :style="{ width: (seg.count / total) * 100 + '%' }"
        :aria-label="`${seg.count} ${seg.label}`"
        :aria-pressed="isActive(seg.status)"
        :title="`${seg.count} ${seg.label}`"
        @click="emit('toggle-status', seg.status)"
      />
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <span class="inline-flex items-center gap-1.5 text-xs font-medium px-1 py-0.5">
        <span class="tabular-nums">{{ total }}</span>
        <span class="text-muted">tests</span>
      </span>
      <button
        v-for="seg in segments"
        :key="seg.key"
        type="button"
        class="inline-flex items-center gap-1.5 text-xs font-medium transition-colors rounded px-1 py-0.5 cursor-pointer hover:bg-elevated"
        :class="isActive(seg.status) ? 'bg-elevated ring-1 ring-default' : ''"
        :aria-pressed="isActive(seg.status)"
        @click="emit('toggle-status', seg.status)"
      >
        <span class="size-2 rounded-full shrink-0" :class="seg.palette.bg" />
        <span class="tabular-nums" :class="seg.palette.text">{{ seg.count }}</span>
        <span class="text-muted">{{ seg.label }}</span>
      </button>
    </div>
  </div>
</template>
