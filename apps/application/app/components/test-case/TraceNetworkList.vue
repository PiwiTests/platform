<script setup lang="ts">
/**
 * The "Full trace" network view: every request the page made (all resource
 * types) on a shared relative waterfall, with the failing action's window
 * shaded so the requests in flight at the moment of failure stand out.
 * A request's duration and bar take the one warning tone only when the
 * duration stands out in the test (`durationStandout`, by its share: the
 * trace's requests have no usual duration), a failed request's bar keeps the
 * failed outcome color. Clicking a row opens the detail drawer (headers,
 * timings, body preview).
 */
import type { TraceNetworkEntry, TraceNetworkResponse } from '~~/types/api';
import { durationStandout, standoutReasonText, type DurationStandout } from '#shared/duration-standout';

const props = defineProps<{
  data: TraceNetworkResponse;
  runId: number | null;
  testRunsCaseId: number;
  /** The test's duration, in ms — a request's duration stands out against it. */
  testDurationMs?: number | null;
}>();

type Filter = 'all' | 'failed' | 'duringFailure';
const filter = ref<Filter>('all');

const requests = computed(() => props.data.requests ?? []);
const totals = computed(() => ({
  total: requests.value.length,
  failed: requests.value.filter((r) => r.failed).length,
  duringFailure: requests.value.filter((r) => r.duringFailure).length,
}));

const filterItems = computed(() => [
  { label: `All (${totals.value.total})`, value: 'all' as const },
  { label: `Failed (${totals.value.failed})`, value: 'failed' as const, disabled: totals.value.failed === 0 },
  {
    label: `During failure (${totals.value.duringFailure})`,
    value: 'duringFailure' as const,
    disabled: totals.value.duringFailure === 0,
  },
]);

const visible = computed(() => {
  if (filter.value === 'failed') return requests.value.filter((r) => r.failed);
  if (filter.value === 'duringFailure') return requests.value.filter((r) => r.duringFailure);
  return requests.value;
});

/** Display the path portion of a request URL; full URL stays available on hover. */
function toPath(url: string): string {
  try {
    return new URL(url).pathname || url;
  } catch {
    return url;
  }
}

const timeline = computed(() => Math.max(1, props.data.timelineDuration ?? 1));

function barStyle(entry: TraceNetworkEntry): Record<string, string> {
  const left = Math.max(0, Math.min(100, (entry.start / timeline.value) * 100));
  const width = Math.min(100 - left, Math.max(1.5, (entry.duration / timeline.value) * 100));
  return { left: `${left}%`, width: `${width}%` };
}

/** The failing action's span on the same timeline, shaded behind every bar. */
const windowStyle = computed<Record<string, string> | null>(() => {
  const w = props.data.failingWindow;
  if (!w || w.end <= w.start) return null;
  const left = Math.max(0, Math.min(100, (w.start / timeline.value) * 100));
  const width = Math.max(0.5, Math.min(100 - left, ((w.end - w.start) / timeline.value) * 100));
  return { left: `${left}%`, width: `${width}%` };
});

function standoutOf(entry: TraceNetworkEntry): DurationStandout | null {
  return durationStandout({ ms: entry.duration, testMs: props.testDurationMs });
}
function standoutTitle(entry: TraceNetworkEntry): string | undefined {
  const standout = standoutOf(entry);
  return standout ? `${formatDuration(entry.duration)}, ${standoutReasonText(standout, formatDuration)}` : undefined;
}

function barColor(entry: TraceNetworkEntry): string {
  if (standoutOf(entry)) return STANDOUT_BAR_CLASS;
  if (entry.failed) return STATUS_PALETTE.failed.bg;
  return DURATION_BAR_CLASS;
}

function rowAccent(entry: TraceNetworkEntry): string {
  if (entry.failed) return 'border-l-2 border-l-status-failed';
  if (entry.duringFailure) return 'border-l-2 border-l-amber-400 dark:border-l-amber-600';
  return 'border-l-2 border-l-transparent';
}

const selected = ref<TraceNetworkEntry | null>(null);
const drawerOpen = ref(false);
function openDrawer(entry: TraceNetworkEntry) {
  selected.value = entry;
  drawerOpen.value = true;
}
</script>

<template>
  <div>
    <div class="flex items-center justify-between gap-2 mb-2">
      <UTabs
        v-model="filter"
        :items="filterItems"
        size="xs"
        variant="link"
        :ui="{ list: 'gap-2', trigger: 'px-1.5' }"
      />
      <span v-if="data.failingWindow" class="hidden sm:flex items-center gap-1.5 text-xs text-gray-400">
        <span class="inline-block w-3 h-2 rounded-sm bg-status-failed/10 border border-status-failed/40" />
        failing action
      </span>
    </div>

    <div class="space-y-1 max-h-[28rem] overflow-y-auto">
      <button
        v-for="entry in visible"
        :key="entry.index"
        type="button"
        :class="rowAccent(entry)"
        class="w-full rounded bg-gray-50/60 dark:bg-gray-800/40 py-1.5 px-2 text-left cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800"
        :title="entry.url"
        @click="openDrawer(entry)"
      >
        <div class="flex items-center gap-2 text-sm min-w-0">
          <UBadge :color="httpMethodColor(entry.method)" variant="soft" size="xs" class="font-mono shrink-0">
            {{ entry.method }}
          </UBadge>
          <UBadge
            :color="httpStatusColor(entry.status)"
            variant="soft"
            size="xs"
            class="font-mono shrink-0 tabular-nums"
            :title="entry.failureText || entry.statusText"
          >
            {{ entry.status > 0 ? entry.status : '—' }}
          </UBadge>
          <code class="truncate text-xs flex-1 min-w-0">{{ toPath(entry.url) }}</code>
          <span v-if="entry.resourceType" class="shrink-0 text-xs text-gray-400 font-mono hidden md:inline">
            {{ entry.resourceType }}
          </span>
          <span
            v-if="entry.responseBodySize != null"
            class="shrink-0 text-xs text-gray-400 tabular-nums hidden sm:inline"
          >
            {{ formatBytes(entry.responseBodySize) }}
          </span>
          <span
            class="ml-1 shrink-0 text-xs tabular-nums"
            :data-standout="standoutOf(entry)?.reason"
            :title="standoutTitle(entry)"
          >
            <DurationValue
              :ms="entry.duration"
              :class="standoutOf(entry) ? STANDOUT_TEXT_CLASS : DURATION_TEXT_CLASS"
              unit-class="opacity-60"
              :no-title="Boolean(standoutOf(entry))"
            />
          </span>
        </div>
        <!-- Waterfall track: this request's span, with the failing window shaded behind it -->
        <div class="relative h-1.5 mt-1 rounded bg-gray-100 dark:bg-gray-800 overflow-hidden">
          <div
            v-if="windowStyle"
            class="absolute inset-y-0 bg-status-failed/10 border-x border-status-failed/30"
            :style="windowStyle"
          />
          <div class="absolute inset-y-0 rounded-full" :class="barColor(entry)" :style="barStyle(entry)" />
        </div>
      </button>
    </div>

    <p v-if="data.truncated" class="mt-2 text-xs text-gray-400 dark:text-gray-500">
      Showing the first {{ requests.length }} of {{ data.totalBeforeCap }} requests recorded in the trace.
    </p>

    <TraceNetworkDrawer
      v-model:open="drawerOpen"
      :entry="selected"
      :run-id="runId"
      :test-runs-case-id="testRunsCaseId"
    />
  </div>
</template>
