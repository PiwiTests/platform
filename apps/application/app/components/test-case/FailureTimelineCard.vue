<script setup lang="ts">
/**
 * The failure timeline: one SVG time axis that places this execution's steps,
 * console entries, network requests and backend log entries on the same clock,
 * with the moment of failure marked and a default window around the failed step.
 * Below the axis sits one steps table: each step carries its offset from the
 * failure (`t-N s`), category, title (the failed step in red with its error),
 * duration with its share of the test and a bar; network, console and backend
 * items in the same window are interleaved as their own rows in time order. The
 * *Around the failure* / *Whole test* toggle drives both the axis and the table.
 *
 * A passing execution has no failure moment: the axis is hidden and the table
 * lists every step without offsets.
 *
 * The axis data comes pre-built from `/timeline` (the pure `buildFailureTimeline`);
 * step detail (category, error, duration share) comes from the `steps` prop. Times
 * shown are relative to the failure moment (`t+0`), so the axis and the table read
 * against the same anchor.
 */
import type { FailureTimeline, TimelineItem, TimelineLane } from '#shared/failure-timeline';
import type { PerformanceStep } from '~~/types/api';
import { useClusterSectionLocator } from '~/composables/useClusterSectionLocator';
import SectionCard from '../shared/SectionCard.vue';
import ChartTooltip from '../shared/ChartTooltip.vue';
import ChartLegend from '../shared/ChartLegend.vue';
import OpenInIdeLink from '../shared/OpenInIdeLink.vue';
import StepLabel from './StepLabel.vue';
import StepParamsDisclosure from './StepParamsDisclosure.vue';

const props = defineProps<{
  testRunsCaseId: number;
  /** The execution's steps — the table's rows and the per-step share and bar. */
  steps: PerformanceStep[];
  /** The execution's total duration, for the per-step share of the test. */
  durationMs: number | null;
  /** Whether this execution failed — a passing one hides the axis and offsets. */
  hasError?: boolean;
  /** Execution status — a did-not-run row shows a neutral step marker. */
  status?: string | null;
  /** Whether a trace exists — enables the "View trace" affordance in the header. */
  hasTrace?: boolean;
  /** Piwi project id/name — passed to the open-in-IDE links for call sites. */
  projectKey?: string | number | null;
  projectName?: string | null;
  /** Drop the card frame and padding — render a plain heading row over the body. */
  embedded?: boolean;
}>();

// The axis only exists for a failure; a passing execution reads its steps off the
// prop and never needs the timeline build.
const { data } = await useFetch<FailureTimeline>(`/api/test-run-cases/${props.testRunsCaseId}/timeline`, {
  immediate: props.hasError !== false,
});

const locator = useClusterSectionLocator();

// The page section a timeline item's ref maps to. Backend log lines live under
// the network card, so they reveal it too; steps switch to the Steps tab.
const SECTION_ACTION: Record<TimelineItem['ref']['section'], string> = {
  steps: 'steps',
  console: 'console',
  networkRequests: 'networkRequests',
  backendLogs: 'networkRequests',
  dialogs: 'console',
};

// ── Placed items and lanes ───────────────────────────────────────────────────
const LANE_ORDER: TimelineLane[] = ['steps', 'network', 'console', 'dialogs', 'backend'];
const LANE_LABEL: Record<TimelineLane, string> = {
  steps: 'Steps',
  network: 'Network',
  console: 'Console',
  dialogs: 'Dialogs',
  backend: 'Backend',
};

const allItems = computed<TimelineItem[]>(() => {
  const tl = data.value;
  if (!tl) return [];
  return LANE_ORDER.flatMap((lane) => tl.lanes[lane]);
});

const placedCount = computed(() => allItems.value.length);
const visibleLanes = computed<TimelineLane[]>(() =>
  data.value ? LANE_ORDER.filter((lane) => data.value!.lanes[lane].length > 0) : [],
);

// The axis (and the offset column) exist only when there is a failure moment to
// anchor them and at least two items to place; a passing execution shows the
// bare steps table.
const hasFailure = computed(() => Boolean(props.hasError) && Boolean(data.value?.failedStep));
const showAxis = computed(() => hasFailure.value && placedCount.value >= 2);

// ── Window mode ──────────────────────────────────────────────────────────────
type WindowMode = 'around' | 'whole';
const mode = ref<WindowMode>('around');
const span = computed(() => (data.value ? Math.max(1, data.value.end - data.value.origin) : 1));
const domain = computed<{ start: number; end: number }>(() => {
  const tl = data.value;
  if (!tl) return { start: 0, end: 1 };
  if (mode.value === 'whole') return { start: 0, end: span.value };
  // A degenerate window (no failed step, or zero-width) falls back to the whole run.
  const w = tl.window;
  return w.end > w.start ? { start: w.start, end: w.end } : { start: 0, end: span.value };
});

// ── SVG geometry ─────────────────────────────────────────────────────────────
const LABEL_W = 62;
const PAD_R = 12;
const TOP = 8;
const LANE_H = 22;
const AXIS_H = 18;

const CALL_BAND_H = 16;

const wrapper = ref<HTMLElement | null>(null);
const { width } = useElementSize(wrapper);
const svgWidth = computed(() => Math.max(0, width.value));
const plotLeft = LABEL_W;
const plotRight = computed(() => Math.max(plotLeft + 1, svgWidth.value - PAD_R));
const plotWidth = computed(() => plotRight.value - plotLeft);
// The "Calls" band sits above the lanes when at least one step has a call site.
const hasCallBand = computed(() => (data.value?.lanes.steps ?? []).some((s) => s.origin != null || s.group != null));
const bandH = computed(() => (hasCallBand.value ? CALL_BAND_H : 0));
const lanesTop = computed(() => TOP + bandH.value);
const lanesHeight = computed(() => visibleLanes.value.length * LANE_H);
const marksBottom = computed(() => lanesTop.value + lanesHeight.value);
const svgHeight = computed(() => marksBottom.value + AXIS_H);

function xOf(at: number): number {
  const { start, end } = domain.value;
  const t = end > start ? (at - start) / (end - start) : 0;
  return plotLeft + Math.max(0, Math.min(1, t)) * plotWidth.value;
}

/** Clamped {x, w} for a bar spanning [at, at+dur], never spilling past the plot. */
function barRect(at: number, dur: number): { x: number; w: number } {
  const x = xOf(at);
  const end = xOf(at + Math.max(0, dur));
  return { x, w: Math.max(2, end - x) };
}

function laneY(lane: TimelineLane): number {
  return lanesTop.value + visibleLanes.value.indexOf(lane) * LANE_H;
}

const failureX = computed(() => (data.value ? xOf(data.value.failureAt) : 0));
const windowShade = computed(() => {
  const tl = data.value;
  if (!tl || mode.value !== 'whole' || tl.window.end <= tl.window.start) return null;
  const x = xOf(tl.window.start);
  return { x, w: Math.max(1, xOf(tl.window.end) - x) };
});

// ── Axis ticks (relative to the failure moment) ──────────────────────────────
// Precision scales with the magnitude: tenths of a second when close, then
// whole seconds, minutes and hours — so a far-off offset reads as `t+3h`, never
// a spurious `t+10755.8s`.
function formatRel(at: number): string {
  const failureAt = data.value?.failureAt ?? 0;
  const d = (at - failureAt) / 1000;
  const a = Math.abs(d);
  if (a < 0.05) return 't+0';
  const sign = d < 0 ? '-' : '+';
  let mag: string;
  if (a < 10) mag = `${a.toFixed(1)}s`;
  else if (a < 90) mag = `${Math.round(a)}s`;
  else if (a < 3600) mag = `${Math.round(a / 60)}m`;
  else mag = `${Math.round(a / 3600)}h`;
  return `t${sign}${mag}`;
}

const ticks = computed(() => {
  const { start, end } = domain.value;
  const count = 5;
  return Array.from({ length: count }, (_, i) => start + ((end - start) * i) / (count - 1));
});

// ── Marks and colors ─────────────────────────────────────────────────────────
function consoleClass(status?: string): string {
  if (status === 'error') return 'fill-red-500';
  if (status === 'warning') return 'fill-amber-500';
  return 'fill-gray-400 dark:fill-gray-500';
}
function backendClass(status?: string): string {
  if (status === 'error' || status === 'fatal') return 'fill-red-500';
  if (status === 'warn' || status === 'warning') return 'fill-amber-500';
  return 'fill-violet-500';
}
function stepClass(item: TimelineItem): string {
  return item.failed ? 'fill-red-500' : 'fill-gray-300 dark:fill-gray-600';
}
function networkClass(item: TimelineItem): string {
  return item.failed ? 'fill-red-400 dark:fill-red-500' : 'fill-sky-400/80 dark:fill-sky-500/70';
}

const legendItems = computed(() => {
  const items: { color: string; label: string }[] = [];
  if (hasCallBand.value) items.push({ color: 'rgb(129, 140, 248)', label: 'Calls' });
  if (visibleLanes.value.includes('steps')) {
    items.push({ color: 'rgb(239, 68, 68)', label: 'Failed step' });
    items.push({ color: 'rgb(156, 163, 175)', label: 'Step' });
  }
  if (visibleLanes.value.includes('network')) items.push({ color: 'rgb(56, 189, 248)', label: 'Request' });
  if (visibleLanes.value.includes('console')) items.push({ color: 'rgb(245, 158, 11)', label: 'Console' });
  if (visibleLanes.value.includes('dialogs')) items.push({ color: 'rgb(20, 184, 166)', label: 'Dialog' });
  if (visibleLanes.value.includes('backend')) items.push({ color: 'rgb(139, 92, 246)', label: 'Backend' });
  return items;
});

// ── Tooltip ──────────────────────────────────────────────────────────────────
const { data: hovered, pos, show, move, hide } = useChartTooltip<TimelineItem>();

// ── "What happened in this window" list ──────────────────────────────────────
const windowItems = computed<TimelineItem[]>(() => {
  const { start, end } = domain.value;
  return allItems.value
    .filter((item) => {
      const itemEnd = item.at + (item.duration ?? 0);
      return itemEnd >= start && item.at <= end;
    })
    .sort((a, b) => a.at - b.at || (a.failed ? -1 : 0));
});

function kindTag(item: TimelineItem): string {
  if (item.kind === 'console') return `console ${item.status ?? ''}`.trim();
  if (item.kind === 'backend') return `backend ${item.status ?? ''}`.trim();
  if (item.kind === 'dialogs') return `dialog ${item.status ?? ''}`.trim();
  return '';
}

// ── Call context (which method / test.step each action came from) ─────────────
function basename(file: string): string {
  const parts = file.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? file;
}
/** The band/group key: the method or test.step title, else the call-site file. */
function callKey(item: TimelineItem): string | null {
  return item.group ?? item.origin?.file ?? null;
}
function callLabel(item: TimelineItem): string {
  return item.group ?? (item.origin ? basename(item.origin.file) : '');
}
/** Runs of consecutive steps that share a call site, drawn as one span in the band. */
const callSpans = computed(() => {
  const steps = data.value?.lanes.steps ?? [];
  const spans: Array<{
    id: string;
    key: string;
    label: string;
    start: number;
    end: number;
    origin: TimelineItem['origin'];
  }> = [];
  let cur: (typeof spans)[number] | null = null;
  for (const step of steps) {
    const key = callKey(step);
    if (key == null) {
      cur = null;
      continue;
    }
    const end = step.at + (step.duration ?? 0);
    if (cur && cur.key === key) {
      cur.end = Math.max(cur.end, end);
    } else {
      cur = { id: step.id, key, label: callLabel(step), start: step.at, end, origin: step.origin ?? null };
      spans.push(cur);
    }
  }
  return spans;
});

function bandTitle(span: { label: string; origin: TimelineItem['origin'] }): string {
  const where = span.origin ? ` · ${span.origin.file}:${span.origin.line}` : '';
  return `${span.label}${where}`;
}

// ── The merged steps table ───────────────────────────────────────────────────
// One row per step, with network / console / backend items interleaved in time
// order. A failing execution reads the rows off the axis window (so the toggle
// drives the table too) and shows each row's offset from the failure; a passing
// one lists every step off the prop, without offsets.
type StepRow = { kind: 'step'; item: TimelineItem | null; step: PerformanceStep; index: number; failed: boolean };
type EventRow = { kind: 'event'; item: TimelineItem };
type MergedRow = StepRow | EventRow;

const mergedRows = computed<MergedRow[]>(() => {
  if (showAxis.value) {
    return windowItems.value.map<MergedRow>((item) => {
      if (item.kind === 'step') {
        const index = item.ref.index;
        return { kind: 'step', item, step: props.steps[index]!, index, failed: Boolean(item.failed) };
      }
      return { kind: 'event', item };
    });
  }
  return props.steps.map<MergedRow>((step, index) => ({
    kind: 'step',
    item: null,
    step,
    index,
    failed: Boolean(step.failed),
  }));
});

const stepCategoryColor: Record<string, 'info' | 'success' | 'warning' | 'neutral'> = {
  navigation: 'info',
  assertion: 'success',
  action: 'warning',
  input: 'warning',
  api: 'info',
  wait: 'neutral',
  hook: 'neutral',
  fixture: 'neutral',
};

// Per-category rollup for the summary strip above the table, over every step
// (parents include their children, matching the reporter's StepMetrics).
const stepSummary = computed(() => {
  const byCat = new Map<string, { count: number; duration: number }>();
  for (const s of props.steps) {
    const entry = byCat.get(s.category) ?? { count: 0, duration: 0 };
    entry.count += 1;
    entry.duration += s.duration || 0;
    byCat.set(s.category, entry);
  }
  return Array.from(byCat, ([category, v]) => ({ category, ...v })).sort((a, b) => b.duration - a.duration);
});

// The single slowest step, tagged in the table. All-zero durations (a test that
// never ran) must not tag row 0 as "slowest".
const slowestStepIndex = computed(() => {
  let idx = -1;
  let max = -1;
  props.steps.forEach((s, i) => {
    if ((s.duration || 0) > max) {
      max = s.duration || 0;
      idx = i;
    }
  });
  return max > 0 ? idx : -1;
});

const maxStepDuration = computed(() => props.steps.reduce((m, s) => Math.max(m, s.duration || 0), 0));

// A true waterfall needs a startTime on every step (only a recent reporter records
// them); otherwise the bars fall back to left-aligned magnitude.
const hasStepTimings = computed(
  () => props.steps.length > 0 && props.steps.every((s) => typeof s.startTime === 'number'),
);
const timelineStart = computed(() =>
  hasStepTimings.value ? Math.min(...props.steps.map((s) => s.startTime as number)) : 0,
);
const stepsSpan = computed(() => {
  const total = props.durationMs ?? 0;
  if (total > 0) return total;
  if (hasStepTimings.value) {
    const end = Math.max(...props.steps.map((s) => (s.startTime as number) + (s.duration || 0)));
    return Math.max(1, end - timelineStart.value);
  }
  return 0;
});

/** Bar geometry for a step: a real waterfall when timings exist, else magnitude. */
function stepBarStyle(step: PerformanceStep): Record<string, string> {
  if (hasStepTimings.value && stepsSpan.value > 0) {
    const left = Math.max(
      0,
      Math.min(100, (((step.startTime as number) - timelineStart.value) / stepsSpan.value) * 100),
    );
    const width = Math.min(100 - left, Math.max(1.5, ((step.duration || 0) / stepsSpan.value) * 100));
    return { left: `${left}%`, width: `${width}%` };
  }
  const width = maxStepDuration.value > 0 ? Math.max(2, ((step.duration || 0) / maxStepDuration.value) * 100) : 0;
  return { left: '0%', width: `${width}%` };
}

/** Step duration as a share of the whole test's wall-clock (e.g. "12%"). */
function stepPctOfTest(duration: number): string {
  const total = props.durationMs ?? 0;
  if (total <= 0) return '';
  const pct = (duration / total) * 100;
  if (pct > 0 && pct < 1) return '<1%';
  return `${Math.round(pct)}%`;
}

/** Severity color for a duration value, shared by the number and its bar. */
function stepDurationTextClass(duration: number): string {
  return duration > 2000 ? 'text-red-600 font-medium' : duration > 500 ? 'text-orange-500' : 'text-gray-500';
}
function stepBarColorClass(duration: number): string {
  return duration > 2000 ? 'bg-red-500' : duration > 500 ? 'bg-orange-400' : 'bg-gray-400 dark:bg-gray-500';
}

// An interleaved event row: its own icon, a kind label and (for a request) a duration.
const EVENT_ICON: Record<'network' | 'console' | 'backend' | 'dialogs', string> = {
  network: 'i-lucide-arrow-left-right',
  console: 'i-lucide-terminal',
  backend: 'i-lucide-server',
  dialogs: 'i-lucide-message-square',
};
function eventIcon(item: TimelineItem): string {
  return EVENT_ICON[item.kind as 'network' | 'console' | 'backend' | 'dialogs'] ?? 'i-lucide-dot';
}
function eventIconClass(item: TimelineItem): string {
  if (item.failed || item.status === 'error' || item.status === 'fatal') return 'text-red-500';
  if (item.status === 'warning' || item.status === 'warn') return 'text-amber-500';
  if (item.kind === 'backend') return 'text-violet-500';
  if (item.kind === 'network') return 'text-sky-500';
  if (item.kind === 'dialogs') return 'text-teal-500';
  return 'text-gray-400 dark:text-gray-500';
}

function revealItem(item: TimelineItem) {
  const sectionId = SECTION_ACTION[item.ref.section];
  if (locator.canLocate(sectionId)) locator.open(sectionId);
}

function onViewTrace() {
  // The bundled viewer has no time deep-link, so this reveals the evidence card
  // that holds the trace and its "View trace" button.
  if (locator.canLocate('tracePointers')) locator.open('tracePointers');
}
</script>

<template>
  <SectionCard
    v-if="steps.length > 0 || (data && placedCount >= 2)"
    :embedded="embedded"
    :icon="embedded ? undefined : showAxis ? 'i-lucide-activity' : 'i-lucide-list-checks'"
    :title="embedded ? '' : showAxis ? 'Failure timeline' : 'Steps'"
    :count="embedded ? null : showAxis ? null : steps.length || null"
    :help="embedded ? undefined : 'case.timeline'"
  >
    <template v-if="showAxis" #actions>
      <ChartLegend :items="legendItems" class="mr-1" />
      <UButton
        v-if="hasTrace"
        size="xs"
        variant="ghost"
        color="neutral"
        icon="i-lucide-film"
        label="View trace"
        @click="onViewTrace"
      />
    </template>

    <div class="space-y-3">
      <!-- Window controls: they drive both the axis and the table below. -->
      <div v-if="showAxis" class="flex items-center gap-1">
        <UButton
          size="xs"
          :variant="mode === 'around' ? 'solid' : 'soft'"
          :color="mode === 'around' ? 'primary' : 'neutral'"
          label="Around the failure"
          @click="mode = 'around'"
        />
        <UButton
          size="xs"
          :variant="mode === 'whole' ? 'solid' : 'soft'"
          :color="mode === 'whole' ? 'primary' : 'neutral'"
          label="Whole test"
          @click="mode = 'whole'"
        />
      </div>

      <!-- SVG axis -->
      <div v-if="showAxis && data" ref="wrapper" class="w-full">
        <svg v-if="plotWidth > 0" :width="svgWidth" :height="svgHeight" class="block">
          <!-- Default-window shade (only meaningful in whole-test view) -->
          <rect
            v-if="windowShade"
            :x="windowShade.x"
            :y="TOP"
            :width="windowShade.w"
            :height="marksBottom - TOP"
            class="fill-gray-400/10 dark:fill-gray-300/5"
          />

          <!-- Calls band: which method / test.step each run of actions came from -->
          <g v-if="hasCallBand">
            <text
              :x="0"
              :y="TOP + CALL_BAND_H / 2"
              dominant-baseline="middle"
              class="fill-gray-500 dark:fill-gray-400 text-[10px]"
            >
              Calls
            </text>
            <g v-for="span in callSpans" :key="span.id">
              <rect
                :x="barRect(span.start, span.end - span.start).x"
                :y="TOP + 2"
                :width="barRect(span.start, span.end - span.start).w"
                :height="CALL_BAND_H - 4"
                rx="2"
                class="fill-indigo-400/70 dark:fill-indigo-500/60"
              >
                <title>{{ bandTitle(span) }}</title>
              </rect>
              <text
                v-if="barRect(span.start, span.end - span.start).w > 44"
                :x="barRect(span.start, span.end - span.start).x + 4"
                :y="TOP + CALL_BAND_H / 2"
                dominant-baseline="middle"
                class="fill-white text-[9px] pointer-events-none"
                :style="{ clipPath: `inset(0 0 0 0)` }"
              >
                {{
                  span.label.length > Math.floor((barRect(span.start, span.end - span.start).w - 8) / 5.5)
                    ? span.label.slice(
                        0,
                        Math.max(1, Math.floor((barRect(span.start, span.end - span.start).w - 8) / 5.5) - 1),
                      ) + '…'
                    : span.label
                }}
              </text>
            </g>
          </g>

          <!-- Lane rows -->
          <g v-for="lane in visibleLanes" :key="lane">
            <text
              :x="0"
              :y="laneY(lane) + LANE_H / 2"
              dominant-baseline="middle"
              class="fill-gray-500 dark:fill-gray-400 text-[10px]"
            >
              {{ LANE_LABEL[lane] }}
            </text>
            <line
              :x1="plotLeft"
              :x2="plotRight"
              :y1="laneY(lane) + LANE_H"
              :y2="laneY(lane) + LANE_H"
              class="stroke-gray-100 dark:stroke-gray-800"
            />
          </g>

          <!-- Step bars -->
          <template v-for="item in data.lanes.steps" :key="item.id">
            <rect
              :x="barRect(item.at, item.duration ?? 0).x"
              :y="laneY('steps') + 4"
              :width="barRect(item.at, item.duration ?? 0).w"
              :height="LANE_H - 8"
              rx="2"
              class="cursor-pointer"
              :class="stepClass(item)"
              @click="revealItem(item)"
              @mouseenter="show($event, item)"
              @mousemove="move($event)"
              @mouseleave="hide()"
            />
          </template>

          <!-- Network bars -->
          <template v-for="item in data.lanes.network" :key="item.id">
            <rect
              :x="barRect(item.at, item.duration ?? 0).x"
              :y="laneY('network') + 4"
              :width="barRect(item.at, item.duration ?? 0).w"
              :height="LANE_H - 8"
              rx="2"
              class="cursor-pointer"
              :class="networkClass(item)"
              @click="revealItem(item)"
              @mouseenter="show($event, item)"
              @mousemove="move($event)"
              @mouseleave="hide()"
            />
          </template>

          <!-- Console marks -->
          <template v-for="item in data.lanes.console" :key="item.id">
            <circle
              :cx="xOf(item.at)"
              :cy="laneY('console') + LANE_H / 2"
              r="4"
              class="cursor-pointer"
              :class="consoleClass(item.status)"
              @click="revealItem(item)"
              @mouseenter="show($event, item)"
              @mousemove="move($event)"
              @mouseleave="hide()"
            />
          </template>

          <!-- Dialog marks -->
          <template v-for="item in data.lanes.dialogs" :key="item.id">
            <circle
              :cx="xOf(item.at)"
              :cy="laneY('dialogs') + LANE_H / 2"
              r="4"
              class="cursor-pointer fill-teal-500"
              @click="revealItem(item)"
              @mouseenter="show($event, item)"
              @mousemove="move($event)"
              @mouseleave="hide()"
            />
          </template>

          <!-- Backend marks -->
          <template v-for="item in data.lanes.backend" :key="item.id">
            <circle
              :cx="xOf(item.at)"
              :cy="laneY('backend') + LANE_H / 2"
              r="4"
              class="cursor-pointer"
              :class="backendClass(item.status)"
              @click="revealItem(item)"
              @mouseenter="show($event, item)"
              @mousemove="move($event)"
              @mouseleave="hide()"
            />
          </template>

          <!-- Failure marker line -->
          <line
            :x1="failureX"
            :x2="failureX"
            :y1="TOP"
            :y2="marksBottom"
            class="stroke-red-500"
            stroke-width="1.5"
            stroke-dasharray="4 3"
          />

          <!-- Axis ticks -->
          <g>
            <text
              v-for="(tick, i) in ticks"
              :key="i"
              :x="Math.max(plotLeft, Math.min(plotRight, xOf(tick)))"
              :y="marksBottom + 12"
              :text-anchor="i === 0 ? 'start' : i === ticks.length - 1 ? 'end' : 'middle'"
              class="fill-gray-400 dark:fill-gray-500 text-[10px] tabular-nums"
            >
              {{ formatRel(tick) }}
            </text>
          </g>
        </svg>
      </div>

      <!-- Filmstrip: the page before each step, from this run's trace screen snapshots. -->
      <TraceFilmstrip :test-runs-case-id="testRunsCaseId" />

      <!-- Estimated-positions note -->
      <p v-if="showAxis && data?.estimated" class="text-xs text-gray-500 dark:text-gray-400 flex items-center gap-1">
        <UIcon name="i-lucide-info" class="size-3.5 shrink-0" />
        Step positions are derived from durations — this run’s reporter did not record step start times.
      </p>

      <!-- The failure happened outside any recorded step. -->
      <UAlert
        v-if="isFailedStatus(status ?? '') && steps.length > 0 && !steps.some((s) => s.failed)"
        color="warning"
        variant="subtle"
        icon="i-lucide-info"
        title="The failure was not captured at step level"
        description="The test failed, but none of the recorded steps is marked failed — the error happened outside the step list."
      />

      <template v-if="steps.length > 0">
        <!-- Per-category summary strip -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span class="font-medium text-gray-600 dark:text-gray-300">{{ steps.length }} steps</span>
          <span class="text-gray-300 dark:text-gray-600">·</span>
          <span v-for="c in stepSummary" :key="c.category" class="inline-flex items-center gap-1">
            <UBadge :color="stepCategoryColor[c.category] || 'neutral'" variant="soft" size="xs">
              {{ c.category }}
            </UBadge>
            <span class="tabular-nums text-gray-500 dark:text-gray-400"
              >×{{ c.count }} · <DurationValue :ms="c.duration"
            /></span>
          </span>
        </div>

        <!-- Phone layout (below `md`): one stacked card per row, so the Step and
             Duration columns are never cut and the page never scrolls sideways.
             The `md`-and-up table below carries the same rows unchanged. -->
        <div class="md:hidden space-y-2">
          <template v-for="row in mergedRows" :key="row.kind === 'step' ? `m-s-${row.index}` : `m-${row.item.id}`">
            <!-- A step row -->
            <div
              v-if="row.kind === 'step'"
              class="rounded-lg border border-default p-2.5"
              :class="row.failed ? 'bg-red-50 dark:bg-red-950/30' : ''"
            >
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  v-if="status === 'didnotrun'"
                  class="inline-flex items-center justify-center size-5 shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-xs leading-none"
                  title="Not run"
                  >–</span
                >
                <span
                  v-else-if="row.failed"
                  class="inline-flex items-center justify-center size-5 shrink-0 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs leading-none"
                  title="Step failed"
                  >✗</span
                >
                <span
                  v-else
                  class="inline-flex items-center justify-center size-5 shrink-0 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs leading-none"
                  title="Step passed"
                  >✓</span
                >
                <UBadge :color="stepCategoryColor[row.step.category] || 'neutral'" variant="soft" size="xs">
                  {{ row.step.category }}
                </UBadge>
                <UBadge
                  v-if="row.index === slowestStepIndex"
                  color="warning"
                  variant="subtle"
                  size="xs"
                  title="Slowest step in this test"
                >
                  slowest
                </UBadge>
                <span
                  v-if="showAxis && row.item"
                  class="ml-auto tabular-nums text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap"
                >
                  {{ formatRel(row.item.at) }}
                </span>
              </div>
              <p
                class="mt-1.5 text-sm break-words"
                :class="row.failed ? 'text-red-600 dark:text-red-400 font-medium' : ''"
              >
                <StepLabel :step="row.step" />
              </p>
              <StepParamsDisclosure :params="row.step.params" class="mt-1" />
              <ErrorText
                v-if="row.failed && row.step.error?.message"
                mode="block"
                :text="row.step.error.message"
                class="mt-1"
              />
              <OpenInIdeLink
                v-if="row.step.location"
                :location="row.step.location"
                :project-key="projectKey ?? undefined"
                :project-name="projectName ?? undefined"
                class="text-xs text-gray-400 dark:text-gray-500 mt-0.5"
              />
              <div class="mt-1.5">
                <div class="flex items-center justify-between gap-2">
                  <DurationValue
                    :ms="row.step.duration"
                    :class="`text-sm ${stepDurationTextClass(row.step.duration)}`"
                    unit-class="opacity-60"
                  />
                  <span
                    v-if="stepPctOfTest(row.step.duration)"
                    class="text-xs tabular-nums text-gray-400 dark:text-gray-500"
                  >
                    {{ stepPctOfTest(row.step.duration) }}
                  </span>
                </div>
                <div class="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    class="absolute inset-y-0 rounded-full"
                    :class="stepBarColorClass(row.step.duration)"
                    :style="stepBarStyle(row.step)"
                  />
                </div>
              </div>
            </div>

            <!-- An interleaved network / console / backend row -->
            <div
              v-else
              class="rounded-lg border border-default p-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60"
              :class="row.item.failed ? 'bg-red-50 dark:bg-red-950/30' : ''"
              @click="revealItem(row.item)"
            >
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <UIcon :name="eventIcon(row.item)" class="size-4 shrink-0" :class="eventIconClass(row.item)" />
                <span class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {{ kindTag(row.item) || row.item.kind }}
                </span>
                <span
                  v-if="showAxis"
                  class="ml-auto tabular-nums text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap"
                >
                  {{ formatRel(row.item.at) }}
                </span>
              </div>
              <div class="mt-1 flex items-baseline justify-between gap-2">
                <span class="font-mono text-xs break-all text-gray-700 dark:text-gray-300">
                  {{ row.item.label
                  }}<span v-if="row.item.kind === 'network'" class="text-gray-500"> → {{ row.item.status }}</span>
                </span>
                <span
                  v-if="row.item.duration != null"
                  class="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400"
                >
                  {{ Math.round(row.item.duration) }} ms
                </span>
              </div>
            </div>
          </template>
        </div>

        <!-- One table: steps, with network / console / backend items interleaved
             in time order. `min-width` keeps the columns readable while the
             wrapper (not the page) scrolls; on a phone the stacked cards above
             replace it, so the table shows from `md` up. -->
        <TableScroller min-width="34rem" :bleed="false" class="hidden md:block">
          <table class="w-full min-w-[34rem] border-separate border-spacing-0 text-sm">
            <thead>
              <tr
                class="[&>th]:bg-elevated/50 [&>th]:border-y [&>th]:border-default [&>th]:px-3 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium [&>th]:text-xs [&>th]:text-gray-500 dark:[&>th]:text-gray-400"
              >
                <th v-if="showAxis" class="w-16 first:rounded-l-lg first:border-l">Time</th>
                <th class="w-8" :class="showAxis ? '' : 'first:rounded-l-lg first:border-l'">
                  <span class="sr-only">Kind</span>
                </th>
                <th class="w-24">Category</th>
                <th>Step</th>
                <th class="w-40 last:rounded-r-lg last:border-r">Duration</th>
              </tr>
            </thead>
            <tbody>
              <template v-for="row in mergedRows" :key="row.kind === 'step' ? `s-${row.index}` : row.item.id">
                <!-- A step row -->
                <tr
                  v-if="row.kind === 'step'"
                  class="[&>td]:border-b [&>td]:border-default [&>td]:px-3 [&>td]:py-2 [&>td]:align-top"
                  :class="row.failed ? 'bg-red-50 dark:bg-red-950/30' : ''"
                >
                  <td v-if="showAxis" class="tabular-nums text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {{ row.item ? formatRel(row.item.at) : '' }}
                  </td>
                  <td>
                    <span
                      v-if="status === 'didnotrun'"
                      class="inline-flex items-center justify-center size-5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-xs leading-none"
                      title="Not run"
                      >–</span
                    >
                    <span
                      v-else-if="row.failed"
                      class="inline-flex items-center justify-center size-5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs leading-none"
                      title="Step failed"
                      >✗</span
                    >
                    <span
                      v-else
                      class="inline-flex items-center justify-center size-5 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs leading-none"
                      title="Step passed"
                      >✓</span
                    >
                  </td>
                  <td>
                    <UBadge :color="stepCategoryColor[row.step.category] || 'neutral'" variant="soft" size="xs">
                      {{ row.step.category }}
                    </UBadge>
                  </td>
                  <td>
                    <div class="flex items-center gap-2">
                      <span :class="row.failed ? 'text-red-600 dark:text-red-400 font-medium' : ''">
                        <StepLabel :step="row.step" />
                      </span>
                      <UBadge
                        v-if="row.index === slowestStepIndex"
                        color="warning"
                        variant="subtle"
                        size="xs"
                        class="shrink-0"
                        title="Slowest step in this test"
                      >
                        slowest
                      </UBadge>
                    </div>
                    <StepParamsDisclosure :params="row.step.params" class="mt-1" />
                    <ErrorText
                      v-if="row.failed && row.step.error?.message"
                      mode="block"
                      :text="row.step.error.message"
                      class="mt-1"
                    />
                    <OpenInIdeLink
                      v-if="row.step.location"
                      :location="row.step.location"
                      :project-key="projectKey ?? undefined"
                      :project-name="projectName ?? undefined"
                      class="text-xs text-gray-400 dark:text-gray-500 mt-0.5"
                    />
                  </td>
                  <td>
                    <div class="min-w-[6rem]">
                      <div class="flex items-center justify-between gap-2">
                        <DurationValue
                          :ms="row.step.duration"
                          :class="`text-sm ${stepDurationTextClass(row.step.duration)}`"
                          unit-class="opacity-60"
                        />
                        <span
                          v-if="stepPctOfTest(row.step.duration)"
                          class="text-xs tabular-nums text-gray-400 dark:text-gray-500"
                        >
                          {{ stepPctOfTest(row.step.duration) }}
                        </span>
                      </div>
                      <div class="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                        <div
                          class="absolute inset-y-0 rounded-full"
                          :class="stepBarColorClass(row.step.duration)"
                          :style="stepBarStyle(row.step)"
                        />
                      </div>
                    </div>
                  </td>
                </tr>

                <!-- An interleaved network / console / backend row -->
                <tr
                  v-else
                  class="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60 [&>td]:border-b [&>td]:border-default [&>td]:px-3 [&>td]:py-2 [&>td]:align-top"
                  :class="row.item.failed ? 'bg-red-50 dark:bg-red-950/30' : ''"
                  @click="revealItem(row.item)"
                >
                  <td v-if="showAxis" class="tabular-nums text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {{ formatRel(row.item.at) }}
                  </td>
                  <td>
                    <UIcon :name="eventIcon(row.item)" class="size-4" :class="eventIconClass(row.item)" />
                  </td>
                  <td class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {{ kindTag(row.item) || row.item.kind }}
                  </td>
                  <td>
                    <span class="font-mono text-xs break-all text-gray-700 dark:text-gray-300">{{
                      row.item.label
                    }}</span>
                    <span v-if="row.item.kind === 'network'" class="font-mono text-xs text-gray-500">
                      → {{ row.item.status }}</span
                    >
                  </td>
                  <td>
                    <span
                      v-if="row.item.duration != null"
                      class="text-xs tabular-nums text-gray-500 dark:text-gray-400"
                    >
                      {{ Math.round(row.item.duration) }} ms
                    </span>
                  </td>
                </tr>
              </template>
            </tbody>
          </table>
        </TableScroller>
      </template>
      <EmptyState v-else icon="i-lucide-list-checks" text="No steps recorded for this execution" />
    </div>

    <Teleport to="body">
      <ChartTooltip v-if="hovered" :pos="pos">
        <p class="tabular-nums text-gray-500 dark:text-gray-400">{{ formatRel(hovered.at) }}</p>
        <p class="font-mono break-words">{{ hovered.label }}</p>
        <p v-if="hovered.kind === 'network'" class="text-gray-500">
          → {{ hovered.status }}<span v-if="hovered.duration != null"> · {{ Math.round(hovered.duration) }} ms</span>
        </p>
        <p v-else-if="hovered.kind === 'step' && hovered.duration != null" class="text-gray-500">
          {{ Math.round(hovered.duration) }} ms<span v-if="hovered.failed" class="text-red-500"> · failed</span>
        </p>
        <p v-else-if="hovered.status" class="text-gray-500">{{ hovered.status }}</p>
      </ChartTooltip>
    </Teleport>
  </SectionCard>
</template>
