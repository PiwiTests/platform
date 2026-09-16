<script setup lang="ts">
import type { NetworkRequest, ServerLogEntry, ServerSpanEntry } from '~~/types/api';
import SectionCard from '../shared/SectionCard.vue';
import CollapsibleSectionCard from '../shared/CollapsibleSectionCard.vue';

const props = defineProps<{
  requests: NetworkRequest[];
  /** Run + case ids and trace presence — enable the "Full trace" go-deeper view. */
  runId?: number | null;
  testRunsCaseId?: number | null;
  hasTrace?: boolean;
  /** When set, the card folds to a header with a peek (persisted per user). */
  storageKey?: string;
  /** Whether the card starts folded on first visit (no stored cookie). */
  defaultFolded?: boolean;
  /** Mark the request list as recovered from the trace (the capture fixtures were absent). */
  derivedFromTrace?: boolean;
  /** Drop the card frame and padding — render a plain heading row over the body. */
  embedded?: boolean;
}>();

const cardComponent = computed(() =>
  props.embedded ? SectionCard : props.storageKey ? CollapsibleSectionCard : SectionCard,
);
const cardBind = computed(() =>
  props.embedded
    ? { embedded: true }
    : props.storageKey
      ? { storageKey: props.storageKey, defaultFolded: props.defaultFolded }
      : {},
);

type Filter = 'all' | 'failed' | 'logs';
const filter = ref<Filter>('all');

// ── Captured vs full-trace view ─────────────────────────────────────────────
// The fixture-captured requests stay the baseline; when the execution has a
// trace, a second view shows every request from the trace's network stream.
// A trace-only execution (no fixture capture) opens directly on the trace.
const {
  data: traceNet,
  pending: tracePending,
  load: loadTraceNet,
} = useTraceNetwork(
  () => props.runId,
  () => props.testRunsCaseId,
  () => !!props.hasTrace,
);

const manualView = ref<'captured' | 'trace' | null>(null);
const view = computed<'captured' | 'trace'>({
  get: () => manualView.value ?? (props.requests.length === 0 && props.hasTrace ? 'trace' : 'captured'),
  set: (value) => {
    manualView.value = value;
  },
});

// Load the trace network on the first switch into the full-trace view. A
// `watch` on the view (not `watchEffect`) keeps `load()`'s internal reactive
// reads out of the dependency set, so toggling pending doesn't re-trigger it.
watch(
  () => view.value === 'trace',
  (isTrace) => {
    if (isTrace) loadTraceNet();
  },
  { immediate: true },
);

const traceCount = computed(() => (traceNet.value?.status === 'ok' ? (traceNet.value.requests?.length ?? 0) : null));
const viewItems = computed(() => [
  { label: `Captured (${props.requests.length})`, value: 'captured' as const, disabled: props.requests.length === 0 },
  { label: traceCount.value != null ? `Full trace (${traceCount.value})` : 'Full trace', value: 'trace' as const },
]);

/** Flip to the full-trace view (diagnosis citation reveal). */
function showTraceMode() {
  if (props.hasTrace) manualView.value = 'trace';
}

// Forward reveal so a jump chip or diagnosis citation can unfold + scroll to this card.
const card = ref<{ reveal?: () => void; $el?: HTMLElement } | null>(null);
function reveal() {
  if (card.value?.reveal) card.value.reveal();
  else card.value?.$el?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
}
defineExpose({ showTraceMode, reveal });

/** Folded peek: the captured request count and the first request, or the trace-only hint. */
const peek = computed(() => {
  const n = props.requests.length;
  if (n === 0) return 'Full network activity from the trace';
  const first = props.requests[0]!;
  return `${n} request${n === 1 ? '' : 's'} · ${first.method} ${toPath(first.url)} → ${first.status}`;
});

/** Per-request expansion state (keyed by stable index). */
const expanded = ref<Set<number>>(new Set());
function toggle(i: number) {
  const next = new Set(expanded.value);
  if (next.has(i)) next.delete(i);
  else next.add(i);
  expanded.value = next;
}

/** Per-log stack-trace expansion state, keyed by `${reqIndex}:${logIndex}`. */
const stackOpen = ref<Set<string>>(new Set());
function toggleStack(key: string) {
  const next = new Set(stackOpen.value);
  if (next.has(key)) next.delete(key);
  else next.add(key);
  stackOpen.value = next;
}

interface DecoratedRequest extends NetworkRequest {
  _index: number;
  logs: ServerLogEntry[];
  spans: ServerSpanEntry[];
  serverMs: number | null;
  errorLogCount: number;
  warnLogCount: number;
  failed: boolean;
  hasDetail: boolean;
  path: string;
}

interface SpanBar extends ServerSpanEntry {
  offsetPct: number;
  widthPct: number;
  depth: number;
}

/** Lay spans out on a shared time axis (0–100%) with parent-chain indentation. */
function buildWaterfall(spans: ServerSpanEntry[]): SpanBar[] {
  if (spans.length === 0) return [];
  const minStart = Math.min(...spans.map((s) => s.startMs));
  const maxEnd = Math.max(...spans.map((s) => s.startMs + s.durMs));
  const total = Math.max(1, maxEnd - minStart);
  const byId = new Map(spans.map((s) => [s.id, s]));
  const depthOf = (s: ServerSpanEntry): number => {
    let depth = 0;
    let cur: ServerSpanEntry | undefined = s;
    const seen = new Set<string>();
    while (cur?.parentId && byId.has(cur.parentId) && !seen.has(cur.id)) {
      seen.add(cur.id);
      cur = byId.get(cur.parentId);
      depth++;
      if (depth > 8) break;
    }
    return depth;
  };
  return [...spans]
    .sort((a, b) => a.startMs - b.startMs || b.durMs - a.durMs)
    .map((s) => ({
      ...s,
      offsetPct: ((s.startMs - minStart) / total) * 100,
      widthPct: Math.max(1.5, (s.durMs / total) * 100),
      depth: depthOf(s),
    }));
}

/** Bar color for a span by outcome, then kind. */
function spanColor(s: ServerSpanEntry): string {
  if (s.status === 'error') return 'bg-red-400 dark:bg-red-500';
  if (s.kind === 'db') return 'bg-violet-400 dark:bg-violet-500';
  if (s.kind === 'client') return 'bg-sky-400 dark:bg-sky-500';
  if (s.kind === 'internal') return 'bg-gray-400 dark:bg-gray-500';
  return 'bg-emerald-400 dark:bg-emerald-500';
}

/** Normalize a log level across integrations (".NET" uses Title case, Nitro lowercase). */
function levelRank(level: string): number {
  const l = level.toLowerCase();
  if (l === 'critical' || l === 'fatal') return 3;
  if (l === 'error') return 2;
  if (l === 'warning' || l === 'warn') return 1;
  return 0;
}

function levelColor(level: string): 'error' | 'warning' | 'info' | 'neutral' {
  const rank = levelRank(level);
  if (rank >= 2) return 'error';
  if (rank === 1) return 'warning';
  const l = level.toLowerCase();
  if (l === 'info' || l === 'information') return 'info';
  return 'neutral';
}

/** Display the path portion of a request URL; full URL stays available on hover. */
function toPath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname || url;
  } catch {
    return url;
  }
}

/** Shorten common content types for a compact per-request label (e.g. `application/json` → `json`). */
function shortContentType(ct: string): string {
  const sub = ct.split('/')[1] ?? ct;
  return sub.replace(/^vnd\.[^+]*\+?/, '').replace(/^x-/, '') || ct;
}

function fullTimestamp(ts?: number): string {
  if (!ts) return '';
  return new Date(ts).toLocaleString();
}

const decorated = computed<DecoratedRequest[]>(() => {
  return props.requests.map((req, i) => {
    const logs = Array.isArray(req.serverLogs) ? req.serverLogs : [];
    const spans = Array.isArray(req.serverTraces) ? req.serverTraces : [];
    let errorLogCount = 0;
    let warnLogCount = 0;
    for (const log of logs) {
      const rank = levelRank(log.level);
      if (rank >= 2) errorLogCount++;
      else if (rank === 1) warnLogCount++;
    }
    // Root request span (no parent) carries server-side processing time.
    const rootSpan = spans.find((s) => !s.parentId) ?? spans[0];
    return {
      ...req,
      _index: i,
      logs: [...logs].sort((a, b) => a.timestamp - b.timestamp),
      spans,
      serverMs: rootSpan ? rootSpan.durMs : null,
      errorLogCount,
      warnLogCount,
      failed: req.status >= 400,
      hasDetail: logs.length > 0 || spans.length > 0,
      path: toPath(req.url),
    };
  });
});

const totals = computed(() => {
  let failed = 0;
  let withLogs = 0;
  let withSpans = 0;
  let errorLogs = 0;
  let warnLogs = 0;
  for (const r of decorated.value) {
    if (r.failed) failed++;
    if (r.logs.length > 0) withLogs++;
    if (r.spans.length > 0) withSpans++;
    errorLogs += r.errorLogCount;
    warnLogs += r.warnLogCount;
  }
  return { total: decorated.value.length, failed, withLogs, withSpans, errorLogs, warnLogs };
});

const hasServerTraces = computed(() => totals.value.withSpans > 0);

const visibleRequests = computed<DecoratedRequest[]>(() => {
  let list = decorated.value;
  if (filter.value === 'failed') list = list.filter((r) => r.failed);
  else if (filter.value === 'logs') list = list.filter((r) => r.logs.length > 0);
  // Surface the requests that matter most: failures and those carrying backend
  // logs float to the top; the rest follow their start time when the capture
  // recorded one, else their original order.
  return [...list].sort((a, b) => {
    const score = (r: DecoratedRequest) =>
      (r.errorLogCount > 0 ? 3 : 0) + (r.failed ? 2 : 0) + (r.logs.length > 0 ? 1 : 0);
    return score(b) - score(a) || (a.startTime ?? 0) - (b.startTime ?? 0) || a._index - b._index;
  });
});

const filterItems = computed(() => [
  { label: `All (${totals.value.total})`, value: 'all' as const },
  { label: `Failed (${totals.value.failed})`, value: 'failed' as const, disabled: totals.value.failed === 0 },
  { label: `With logs (${totals.value.withLogs})`, value: 'logs' as const, disabled: totals.value.withLogs === 0 },
]);

const hasBackendLogs = computed(() => totals.value.withLogs > 0);

/** Accent border for a request row based on the worst signal it carries. */
function rowAccent(r: DecoratedRequest): string {
  if (r.errorLogCount > 0 || r.status >= 500) return 'border-l-2 border-l-red-400 dark:border-l-red-600';
  if (r.failed || r.warnLogCount > 0) return 'border-l-2 border-l-amber-400 dark:border-l-amber-600';
  return 'border-l-2 border-l-transparent';
}
</script>

<template>
  <component
    :is="cardComponent"
    ref="card"
    v-bind="cardBind"
    :icon="embedded ? undefined : 'i-lucide-network'"
    :title="embedded ? '' : 'Network requests'"
    :count="embedded ? null : view === 'trace' ? traceCount : totals.total"
    :help="embedded ? undefined : 'case.network'"
  >
    <template v-if="storageKey" #folded>{{ peek }}</template>
    <template #actions>
      <div class="flex flex-wrap items-center gap-x-3 gap-y-1">
        <TraceDerivedChip v-if="derivedFromTrace" />
        <template v-if="view === 'captured'">
          <div v-if="totals.errorLogs > 0 || totals.warnLogs > 0" class="flex items-center gap-2 text-xs">
            <span v-if="totals.errorLogs > 0" class="flex items-center gap-1 text-red-600 dark:text-red-400">
              <UIcon name="i-lucide-octagon-alert" class="size-3.5" />{{ totals.errorLogs }}
            </span>
            <span v-if="totals.warnLogs > 0" class="flex items-center gap-1 text-amber-600 dark:text-amber-400">
              <UIcon name="i-lucide-triangle-alert" class="size-3.5" />{{ totals.warnLogs }}
            </span>
          </div>
          <UTabs
            v-model="filter"
            :items="filterItems"
            size="xs"
            variant="link"
            :ui="{ list: 'gap-2', trigger: 'px-1.5' }"
          />
        </template>
        <UTabs
          v-if="hasTrace"
          v-model="view"
          :items="viewItems"
          size="xs"
          variant="pill"
          :ui="{ list: 'gap-1 p-0.5', trigger: 'px-2' }"
        />
      </div>
    </template>

    <!-- Full trace view: every request from the trace's network stream -->
    <template v-if="view === 'trace'">
      <LoadingState v-if="tracePending || !traceNet" text="Parsing trace network stream…" />
      <TraceNetworkList
        v-else-if="traceNet.status === 'ok'"
        :data="traceNet"
        :run-id="runId ?? null"
        :test-runs-case-id="testRunsCaseId ?? 0"
      />
      <p v-else class="text-xs text-gray-400 py-2">No network activity recorded in this trace.</p>
    </template>

    <div v-else class="space-y-1 max-h-[28rem] overflow-y-auto">
      <div
        v-for="req in visibleRequests"
        :key="req._index"
        :class="rowAccent(req)"
        class="rounded bg-gray-50/60 dark:bg-gray-800/40"
      >
        <!-- Request line -->
        <button
          type="button"
          class="w-full flex items-center gap-2 py-1.5 px-2 text-sm text-left"
          :class="req.hasDetail ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800' : 'cursor-default'"
          :disabled="!req.hasDetail"
          @click="req.hasDetail && toggle(req._index)"
        >
          <UIcon
            v-if="req.hasDetail"
            :name="expanded.has(req._index) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-3.5 shrink-0 text-gray-400"
          />
          <span v-else class="size-3.5 shrink-0" />

          <UBadge :color="httpMethodColor(req.method)" variant="soft" size="xs" class="font-mono shrink-0">
            {{ req.method }}
          </UBadge>
          <UBadge :color="httpStatusColor(req.status)" variant="soft" size="xs" class="font-mono shrink-0 tabular-nums">
            {{ req.status || '—' }}
          </UBadge>

          <code class="truncate text-xs flex-1 min-w-0" :title="req.url">{{ req.path }}</code>

          <span
            v-if="req.contentType"
            class="shrink-0 text-xs text-gray-400 font-mono hidden md:inline"
            :title="`Response content type: ${req.contentType}`"
            >{{ shortContentType(req.contentType) }}</span
          >

          <span
            v-if="req.errorLogCount > 0"
            class="shrink-0 inline-flex items-center gap-1 text-xs text-red-600 dark:text-red-400"
            :title="`${req.errorLogCount} backend error log(s)`"
          >
            <UIcon name="i-lucide-octagon-alert" class="size-3.5" />{{ req.errorLogCount }}
          </span>
          <span
            v-if="req.warnLogCount > 0"
            class="shrink-0 inline-flex items-center gap-1 text-xs text-amber-600 dark:text-amber-400"
            :title="`${req.warnLogCount} backend warning log(s)`"
          >
            <UIcon name="i-lucide-triangle-alert" class="size-3.5" />{{ req.warnLogCount }}
          </span>

          <span
            v-if="req.serverMs != null"
            class="shrink-0 inline-flex items-center gap-1 text-xs text-emerald-600 dark:text-emerald-400 tabular-nums"
            :title="`Server-side processing time (${req.spans.length} span${req.spans.length === 1 ? '' : 's'})`"
          >
            <UIcon name="i-lucide-server" class="size-3.5" /><DurationValue :ms="req.serverMs" no-title />
          </span>

          <span
            v-if="req.startTime"
            class="shrink-0 text-xs text-gray-400 hidden sm:inline"
            :title="fullTimestamp(req.startTime)"
          >
            {{ formatRelativeTime(req.startTime) }}
          </span>
          <span
            class="ml-1 shrink-0 text-xs tabular-nums"
            :class="
              (req.duration ?? 0) > 1000
                ? 'text-red-600 font-medium'
                : (req.duration ?? 0) > 500
                  ? 'text-orange-500'
                  : 'text-gray-500'
            "
          >
            <DurationValue :ms="req.duration" unit-class="opacity-60" />
          </span>
        </button>

        <!-- Server-side span waterfall for this request -->
        <div v-if="req.spans.length > 0 && expanded.has(req._index)" class="px-2 pt-1.5 pb-2 pl-7 space-y-1">
          <div class="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-gray-400">
            <UIcon name="i-lucide-waypoints" class="size-3.5" />Server trace
          </div>
          <div
            v-for="span in buildWaterfall(req.spans)"
            :key="span.id"
            class="flex items-center gap-2 text-xs"
            :title="span.status === 'error' ? `${span.name} (error)` : span.name"
          >
            <div
              class="w-40 sm:w-56 shrink-0 flex items-center gap-1 min-w-0"
              :style="{ paddingLeft: `${span.depth * 12}px` }"
            >
              <span v-if="span.kind" class="shrink-0 text-[10px] uppercase text-gray-400 font-mono hidden sm:inline">{{
                span.kind
              }}</span>
              <span
                class="truncate font-mono"
                :class="span.status === 'error' ? 'text-red-600 dark:text-red-400' : 'text-gray-600 dark:text-gray-300'"
                >{{ span.name }}</span
              >
            </div>
            <div class="relative flex-1 h-3 rounded bg-gray-100 dark:bg-gray-800 min-w-0">
              <div
                class="absolute top-0 h-3 rounded"
                :class="spanColor(span)"
                :style="{ left: `${span.offsetPct}%`, width: `${span.widthPct}%` }"
              />
            </div>
            <DurationValue :ms="span.durMs" class="w-12 shrink-0 text-right text-gray-500" />
          </div>
        </div>

        <!-- Backend logs for this request -->
        <div v-if="req.logs.length > 0 && expanded.has(req._index)" class="px-2 pb-2 pl-7 space-y-1.5">
          <div
            v-for="(log, li) in req.logs"
            :key="li"
            class="rounded border border-default bg-white dark:bg-gray-900/60 p-2 text-xs"
          >
            <div class="flex items-start gap-2">
              <UBadge :color="levelColor(log.level)" variant="soft" size="xs" class="shrink-0 capitalize">
                {{ log.level }}
              </UBadge>
              <span v-if="log.category" class="text-gray-400 shrink-0 font-mono">[{{ log.category }}]</span>
              <span class="font-mono break-all text-gray-700 dark:text-gray-300 flex-1 min-w-0">{{ log.message }}</span>
              <span
                v-if="log.timestamp"
                class="shrink-0 text-gray-400 tabular-nums"
                :title="fullTimestamp(log.timestamp)"
              >
                {{ formatRelativeTime(log.timestamp) }}
              </span>
            </div>
            <div v-if="log.stack" class="mt-1.5">
              <button
                type="button"
                class="inline-flex items-center gap-1 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
                @click="toggleStack(`${req._index}:${li}`)"
              >
                <UIcon
                  :name="stackOpen.has(`${req._index}:${li}`) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                  class="size-3"
                />
                Stack trace
              </button>
              <pre
                v-if="stackOpen.has(`${req._index}:${li}`)"
                class="mt-1 whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-gray-500 dark:text-gray-400 max-h-48 overflow-y-auto"
                >{{ log.stack }}</pre>
            </div>
          </div>
        </div>
      </div>
    </div>

    <p
      v-if="view === 'captured' && !hasBackendLogs"
      class="mt-3 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500"
    >
      <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
      No backend server logs captured — install
      <DocLink to="guide/backend-logs" no-icon class="underline">a Piwi backend integration</DocLink>
      to see server-side warnings and errors under each request.
    </p>

    <p v-if="!hasTrace" class="mt-3 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
      <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
      <span>
        Want to go deeper? Record traces (<code>trace: 'retain-on-failure'</code>) to see every request with headers,
        timing and bodies here.
        <DocLink to="features/evidence#trace-powered-deep-views" no-icon class="underline">Learn more</DocLink>
      </span>
    </p>
  </component>
</template>
