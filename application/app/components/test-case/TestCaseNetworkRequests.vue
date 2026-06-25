<script setup lang="ts">
import type { NetworkRequest, ServerLogEntry } from '~~/types/api';

const props = defineProps<{
  requests: NetworkRequest[];
}>();

type Filter = 'all' | 'failed' | 'logs';
const filter = ref<Filter>('all');

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
  errorLogCount: number;
  warnLogCount: number;
  failed: boolean;
  path: string;
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

function methodColor(method: string): 'info' | 'success' | 'error' | 'warning' | 'neutral' {
  switch (method.toUpperCase()) {
    case 'GET':
      return 'info';
    case 'POST':
      return 'success';
    case 'DELETE':
      return 'error';
    case 'PUT':
    case 'PATCH':
      return 'warning';
    default:
      return 'neutral';
  }
}

function statusColor(status: number): 'success' | 'warning' | 'error' | 'neutral' {
  if (!status) return 'neutral';
  if (status >= 500) return 'error';
  if (status >= 400) return 'warning';
  return 'success';
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
    let errorLogCount = 0;
    let warnLogCount = 0;
    for (const log of logs) {
      const rank = levelRank(log.level);
      if (rank >= 2) errorLogCount++;
      else if (rank === 1) warnLogCount++;
    }
    return {
      ...req,
      _index: i,
      logs: [...logs].sort((a, b) => a.timestamp - b.timestamp),
      errorLogCount,
      warnLogCount,
      failed: req.status >= 400,
      path: toPath(req.url),
    };
  });
});

const totals = computed(() => {
  let failed = 0;
  let withLogs = 0;
  let errorLogs = 0;
  let warnLogs = 0;
  for (const r of decorated.value) {
    if (r.failed) failed++;
    if (r.logs.length > 0) withLogs++;
    errorLogs += r.errorLogCount;
    warnLogs += r.warnLogCount;
  }
  return { total: decorated.value.length, failed, withLogs, errorLogs, warnLogs };
});

const visibleRequests = computed<DecoratedRequest[]>(() => {
  let list = decorated.value;
  if (filter.value === 'failed') list = list.filter((r) => r.failed);
  else if (filter.value === 'logs') list = list.filter((r) => r.logs.length > 0);
  // Surface the requests that matter most: failures and those carrying backend
  // logs float to the top; the rest keep their original (chronological) order.
  return [...list].sort((a, b) => {
    const score = (r: DecoratedRequest) => (r.errorLogCount > 0 ? 3 : 0) + (r.failed ? 2 : 0) + (r.logs.length > 0 ? 1 : 0);
    return score(b) - score(a) || a._index - b._index;
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
  <SectionCard
    icon="i-lucide-network"
    title="Network & backend logs"
    :count="totals.total"
    help="case.network"
  >
    <template #actions>
      <div class="flex items-center gap-3">
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
      </div>
    </template>

    <div class="space-y-1 max-h-[28rem] overflow-y-auto">
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
          :class="req.logs.length > 0 ? 'cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-800' : 'cursor-default'"
          :disabled="req.logs.length === 0"
          @click="req.logs.length > 0 && toggle(req._index)"
        >
          <UIcon
            v-if="req.logs.length > 0"
            :name="expanded.has(req._index) ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
            class="size-3.5 shrink-0 text-gray-400"
          />
          <span v-else class="size-3.5 shrink-0" />

          <UBadge :color="methodColor(req.method)" variant="soft" size="xs" class="font-mono shrink-0">
            {{ req.method }}
          </UBadge>
          <UBadge :color="statusColor(req.status)" variant="soft" size="xs" class="font-mono shrink-0 tabular-nums">
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
            >{{ formatDuration(req.duration) }}</span
          >
        </button>

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
                >{{ log.stack }}</pre
              >
            </div>
          </div>
        </div>
      </div>
    </div>

    <p v-if="!hasBackendLogs" class="mt-3 flex items-center gap-1.5 text-xs text-gray-400 dark:text-gray-500">
      <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
      No backend server logs captured — install
      <DocLink to="backend-logs" no-icon class="underline">a Piwi backend integration</DocLink>
      to see server-side warnings and errors under each request.
    </p>
  </SectionCard>
</template>
