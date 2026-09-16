<script setup lang="ts">
/**
 * The run's one count bar: a proportional stacked bar with the counts on
 * clickable segments. Each segment is a filter — clicking it toggles that
 * status in the Tests tab's filter set and switches to the Tests tab. Zero-count
 * segments are hidden. Flaky (passed on retry) is a subset of passed, so it is
 * subtracted from the passed segment to avoid double-counting.
 */
const props = defineProps<{
  passed: number;
  failed: number;
  flaky: number;
  skipped: number;
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
  bar: string;
  active: string;
  chip: string;
}

const segments = computed<Segment[]>(() => {
  const passedOnly = Math.max(0, props.passed - props.flaky);
  return (
    [
      {
        key: 'passed',
        status: 'passed',
        label: 'passed',
        count: passedOnly,
        bar: 'bg-emerald-500',
        active: 'ring-2 ring-emerald-500',
        chip: 'text-emerald-700 dark:text-emerald-400',
      },
      {
        key: 'failed',
        status: 'failed',
        label: 'failed',
        count: props.failed,
        bar: 'bg-rose-500',
        active: 'ring-2 ring-rose-500',
        chip: 'text-rose-700 dark:text-rose-400',
      },
      {
        key: 'flaky',
        status: 'flaky',
        label: 'passed on retry',
        count: props.flaky,
        bar: 'bg-orange-500',
        active: 'ring-2 ring-orange-500',
        chip: 'text-orange-700 dark:text-orange-400',
      },
      {
        key: 'skipped',
        status: 'skipped',
        label: 'skipped',
        count: props.skipped,
        bar: 'bg-zinc-400',
        active: 'ring-2 ring-zinc-500',
        chip: 'text-zinc-600 dark:text-zinc-400',
      },
      {
        key: 'didnotrun',
        status: 'didnotrun',
        label: "didn't run",
        count: props.didNotRun,
        bar: 'bg-amber-400 dark:bg-amber-600',
        active: 'ring-2 ring-amber-500',
        chip: 'text-amber-700 dark:text-amber-400',
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
        :class="[seg.bar, isActive(seg.status) ? seg.active : '']"
        :style="{ width: (seg.count / total) * 100 + '%' }"
        :aria-label="`${seg.count} ${seg.label}`"
        :aria-pressed="isActive(seg.status)"
        :title="`${seg.count} ${seg.label}`"
        @click="emit('toggle-status', seg.status)"
      />
    </div>
    <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
      <button
        v-for="seg in segments"
        :key="seg.key"
        type="button"
        class="inline-flex items-center gap-1.5 text-xs font-medium transition-colors rounded px-1 py-0.5 cursor-pointer hover:bg-elevated"
        :class="isActive(seg.status) ? 'bg-elevated ring-1 ring-default' : ''"
        :aria-pressed="isActive(seg.status)"
        @click="emit('toggle-status', seg.status)"
      >
        <span class="size-2 rounded-full shrink-0" :class="seg.bar" />
        <span class="tabular-nums" :class="seg.chip">{{ seg.count }}</span>
        <span class="text-muted">{{ seg.label }}</span>
      </button>
    </div>
  </div>
</template>
