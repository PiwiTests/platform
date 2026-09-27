<script setup lang="ts">
/**
 * The failure timeline: one SVG time axis that places this execution's steps,
 * console entries, network requests and backend log entries on the same clock,
 * with the moment of failure marked and a default window around the failed step.
 * Below the axis sits one steps table: each step carries its offset from the
 * failure (`t-N s`), category, title (the failed step in red with its error),
 * duration with its share of the test and a bar; network, console and backend
 * items in the same window are interleaved as their own rows in time order. The
 * *Around the failure* / *Whole test* toggle drives both the axis and the table,
 * and so does the type filter under it: one chip per item type in the window,
 * keying its lane, the choice kept per browser. The axis draws only the items
 * in the window, and the failing step always shows.
 *
 * The table reads the steps as Playwright's tree: a `test.step`'s steps sit
 * indented under it, and the hooks and fixtures that ran before and after the
 * test body fold into a Setup and a Teardown section — open when the failure
 * happened there. The step that failed is the innermost of the failing chain;
 * every step around it carries the failed mark too. The capture's own steps
 * are never listed, and locations read relative to the project.
 *
 * A passing execution has no failure moment: the axis is hidden and the table
 * lists every step without offsets.
 *
 * The axis data comes pre-built from `/timeline` (the pure `buildFailureTimeline`);
 * step detail (category, error, duration share) comes from the `steps` prop. Times
 * shown are relative to the failure moment (`t+0`), so the axis and the table read
 * against the same anchor.
 */
import type { FailureTimeline, TimelineItem, TimelineLane, TimelineLanes } from '#shared/failure-timeline';
import type { AttachmentInfo, PerformanceStep } from '~~/types/api';
import { useClusterSectionLocator } from '~/composables/useClusterSectionLocator';
import { useTimelineTypeFilter } from '~/composables/useTimelineTypeFilter';
import {
  TIMELINE_TYPES,
  TIMELINE_TYPE_META,
  effectiveHiddenTypes,
  isTimelineItemShown,
  timelineItemSeverity,
} from '~/utils/timeline-type-filter';
import SectionCard from '../shared/SectionCard.vue';
import ChartTooltip from '../shared/ChartTooltip.vue';
import ChartLegend from '../shared/ChartLegend.vue';
import OpenInIdeLink from '../shared/OpenInIdeLink.vue';
import StepLabel from './StepLabel.vue';
import StepParamsDisclosure from './StepParamsDisclosure.vue';
import TimelineTypeFilter from './TimelineTypeFilter.vue';
import { findLocationRoot, stepLocations, stripLocationRoot } from '#shared/locator-chain';
import { isFailedStep, type StepPhase } from '#shared/step-tree';
import { buildStepTreeView, groupRowsBySection, sectionSummaryText } from '~/utils/timeline-rows';

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
  /** The test's project-relative file — step locations read relative to the project it shows. */
  testFilePath?: string | null;
  /** Piwi project id/name — passed to the open-in-IDE links for call sites. */
  projectKey?: string | number | null;
  projectName?: string | null;
  /** The execution's attachments — a failure screenshot binds to the failing step for pre-1.63 traces. */
  attachments?: AttachmentInfo[] | null;
  /** The execution's recovered failure-time ARIA tree — shown on the failing step when the trace has no per-action aria. */
  ariaSnapshot?: string | null;
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
const allItems = computed<TimelineItem[]>(() => {
  const tl = data.value;
  if (!tl) return [];
  return TIMELINE_TYPES.flatMap((lane) => tl.lanes[lane]);
});

const placedCount = computed(() => allItems.value.length);

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

/** Whether an item overlaps the window — only those are drawn, listed and counted. */
function inWindow(item: TimelineItem): boolean {
  const { start, end } = domain.value;
  return item.at + (item.duration ?? 0) >= start && item.at <= end;
}

/** Every item in the window, in time order, whatever the type filter hides. */
const windowItems = computed<TimelineItem[]>(() =>
  allItems.value.filter(inWindow).sort((a, b) => a.at - b.at || (a.failed ? -1 : 0)),
);

// ── Type filter ──────────────────────────────────────────────────────────────
// One chip per type with items in the window, once there are two to choose
// between. The stored choice applies only while the chips are on screen, and
// only to the types they show.
const {
  hidden: storedHiddenTypes,
  toggle: toggleType,
  only: onlyType,
  showAll: showAllTypes,
} = useTimelineTypeFilter();
const windowTypes = computed<TimelineLane[]>(() =>
  TIMELINE_TYPES.filter((lane) => windowItems.value.some((item) => item.lane === lane)),
);
const showTypeFilter = computed(() => showAxis.value && windowTypes.value.length >= 2);
const hiddenTypes = computed<TimelineLane[]>(() =>
  showTypeFilter.value ? effectiveHiddenTypes(storedHiddenTypes.value, windowTypes.value) : [],
);
const hiddenTypeSet = computed(() => new Set(hiddenTypes.value));

function isShown(item: TimelineItem): boolean {
  return isTimelineItemShown(item, hiddenTypeSet.value);
}

/** The window's items that pass the type filter — the table's rows. */
const shownWindowItems = computed<TimelineItem[]>(() => windowItems.value.filter(isShown));

/** Each lane's items in the window that pass the type filter — what the axis draws. */
const shownLanes = computed<TimelineLanes>(() => {
  const lanes = data.value?.lanes;
  const keep = (items: TimelineItem[] | undefined) => (items ?? []).filter((item) => inWindow(item) && isShown(item));
  return {
    steps: keep(lanes?.steps),
    network: keep(lanes?.network),
    console: keep(lanes?.console),
    dialogs: keep(lanes?.dialogs),
    backend: keep(lanes?.backend),
  };
});
const visibleLanes = computed<TimelineLane[]>(() => TIMELINE_TYPES.filter((lane) => shownLanes.value[lane].length > 0));

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
// The "Calls" band sits above the lanes when at least one shown step has a call site.
const hasCallBand = computed(() => shownLanes.value.steps.some((s) => s.origin != null || s.group != null));
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
/** Each tick's label, blank where it would repeat the one before (a short window rounds several to `t+0`). */
const tickLabels = computed(() =>
  ticks.value.map((tick, i, all) => {
    const label = formatRel(tick);
    return i > 0 && formatRel(all[i - 1]!) === label ? '' : label;
  }),
);

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

// Beside the type chips, which key the lanes, the key keeps what they do not
// say: the Calls band, the red of a failure or error, the amber of a warning.
const markKeyItems = computed(() => {
  const items: { color: string; label: string }[] = [];
  if (hasCallBand.value) items.push({ color: 'rgb(129, 140, 248)', label: 'Calls' });
  items.push({ color: 'rgb(239, 68, 68)', label: 'Failed or error' });
  if (shownWindowItems.value.some((item) => timelineItemSeverity(item) === 'warning')) {
    items.push({ color: 'rgb(245, 158, 11)', label: 'Warning' });
  }
  return items;
});

// ── Tooltip ──────────────────────────────────────────────────────────────────
const { data: hovered, pos, show, move, hide } = useChartTooltip<TimelineItem>();

// A mark the type filter removes fires no mouseleave, so its tooltip goes with it.
watch(hiddenTypeSet, () => hide());

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
/** Runs of consecutive shown steps that share a call site, drawn as one span in the band. */
const callSpans = computed(() => {
  const steps = shownLanes.value.steps;
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
// order. A failing execution reads the rows off the axis window and the type
// filter (so both toggles drive the table too) and shows each row's offset from
// the failure; a passing one lists every step off the prop, without offsets.
// The rows then fold into sections: the setup and teardown hooks around the
// test body.
const tree = computed(() => buildStepTreeView(props.steps));

type StepRow = {
  kind: 'step';
  item: TimelineItem | null;
  step: PerformanceStep;
  index: number;
  /** The step failed — the failing step itself or a step around it. */
  failed: boolean;
  /** The step that failed: its row carries the error and the page at that moment. */
  failing: boolean;
  level: number;
};
type EventRow = { kind: 'event'; item: TimelineItem };
type MergedRow = StepRow | EventRow;

function stepRow(step: PerformanceStep, index: number, item: TimelineItem | null): StepRow {
  return {
    kind: 'step',
    item,
    step,
    index,
    failed: isFailedStep(step),
    failing: index === tree.value.failingIndex,
    level: tree.value.level[index] ?? 0,
  };
}

const mergedRows = computed<MergedRow[]>(() => {
  const hidden = tree.value.hidden;
  if (showAxis.value) {
    return shownWindowItems.value.flatMap<MergedRow>((item) => {
      if (item.kind !== 'step') return [{ kind: 'event', item }];
      const index = item.ref.index;
      const step = props.steps[index];
      return step && !hidden.has(index) ? [stepRow(step, index, item)] : [];
    });
  }
  return props.steps.flatMap<MergedRow>((step, index) => (hidden.has(index) ? [] : [stepRow(step, index, null)]));
});

// ── Setup and teardown sections ──────────────────────────────────────────────
// The hooks and fixtures before and after the test body fold into one header
// row each; a section opens by itself when the failure happened in it.
const openSections = ref<Set<StepPhase>>(new Set());
function resetOpenSections() {
  const failing = tree.value.failingIndex;
  const phase = failing === null ? null : tree.value.phases[failing];
  openSections.value = new Set(phase && phase !== 'body' ? [phase] : []);
}
watch(() => props.testRunsCaseId, resetOpenSections, { immediate: true });
function toggleSection(section: StepPhase) {
  const next = new Set(openSections.value);
  if (next.has(section)) next.delete(section);
  else next.add(section);
  openSections.value = next;
}

const SECTION_LABEL: Record<StepPhase, string> = { setup: 'Setup', body: 'Test', teardown: 'Teardown' };

type SectionEntry = {
  kind: 'section';
  key: string;
  section: StepPhase;
  label: string;
  summary: string;
  durationMs: number;
  failed: boolean;
  open: boolean;
  /** The offset of the section's first row, for the Time column. */
  at: number | null;
};
type RenderEntry = SectionEntry | (MergedRow & { key: string; nested: boolean });

const renderList = computed<RenderEntry[]>(() => {
  const blocks = groupRowsBySection(mergedRows.value, (row) =>
    row.kind === 'step' ? (tree.value.phases[row.index] ?? 'body') : null,
  );
  const out: RenderEntry[] = [];
  blocks.forEach((block, b) => {
    const rowKey = (row: MergedRow) => (row.kind === 'step' ? `s-${row.index}` : row.item.id);
    if (block.section === 'body') {
      for (const row of block.rows) out.push({ ...row, key: rowKey(row), nested: false });
      return;
    }
    const summary = tree.value.sections[block.section];
    const open = openSections.value.has(block.section);
    const first = block.rows[0]!;
    out.push({
      kind: 'section',
      key: `section-${block.section}-${b}`,
      section: block.section,
      label: SECTION_LABEL[block.section],
      summary: summary ? sectionSummaryText(summary) : '',
      durationMs: summary?.durationMs ?? 0,
      failed: Boolean(summary?.failed),
      open,
      at: first.kind === 'step' ? (first.item?.at ?? null) : first.item.at,
    });
    if (open) for (const row of block.rows) out.push({ ...row, key: rowKey(row), nested: true });
  });
  return out;
});

/** The left inset of a step's title: its depth in the tree, plus one inside a section. */
function stepIndent(row: StepRow & { nested: boolean }): Record<string, string> {
  const level = row.level + (row.nested ? 1 : 0);
  return level > 0 ? { paddingInlineStart: `${level * 1.25}rem` } : {};
}

// Step locations read relative to the project, found from the test's own file.
const locationRoot = computed(() => findLocationRoot(stepLocations(props.steps), props.testFilePath ?? null));
function displayLocation(location: string): string {
  return stripLocationRoot(location, locationRoot.value);
}

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

// The steps of the test body that did the work: listed, and holding no other
// step (a test.step's time is its children's).
const bodyLeafIndices = computed(() =>
  props.steps
    .map((_, i) => i)
    .filter((i) => tree.value.phases[i] === 'body' && !tree.value.hidden.has(i) && !tree.value.groups.has(i)),
);

// A setup failure stops the test before its body; a body with no steps of its
// own (a test that makes no Playwright calls) still ran.
const bodyNeverRan = computed(() => bodyLeafIndices.value.length === 0 && Boolean(tree.value.sections.setup?.failed));

// Per-category rollup for the summary strip above the table, over the test
// body's steps; setup and teardown follow as one figure each.
const stepSummary = computed(() => {
  const byCat = new Map<string, { count: number; duration: number }>();
  for (const i of bodyLeafIndices.value) {
    const s = props.steps[i]!;
    const entry = byCat.get(s.category) ?? { count: 0, duration: 0 };
    entry.count += 1;
    entry.duration += s.duration || 0;
    byCat.set(s.category, entry);
  }
  return Array.from(byCat, ([category, v]) => ({ category, ...v })).sort((a, b) => b.duration - a.duration);
});
const sectionTimes = computed(() =>
  (['setup', 'teardown'] as const).flatMap((section) => {
    const summary = tree.value.sections[section];
    return summary && summary.durationMs > 0
      ? [{ label: SECTION_LABEL[section].toLowerCase(), ms: summary.durationMs }]
      : [];
  }),
);

// The single slowest step of the test body, tagged in the table. All-zero
// durations (a test that never ran) must not tag row 0 as "slowest".
const slowestStepIndex = computed(() => {
  let idx = -1;
  let max = -1;
  for (const i of bodyLeafIndices.value) {
    const duration = props.steps[i]!.duration || 0;
    if (duration > max) {
      max = duration;
      idx = i;
    }
  }
  return max > 0 ? idx : -1;
});

const maxStepDuration = computed(() =>
  mergedRows.value.reduce((m, row) => (row.kind === 'step' ? Math.max(m, row.step.duration || 0) : m), 0),
);

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

// An interleaved event row: its type's icon, a kind label and (for a request) a duration.
function eventIcon(item: TimelineItem): string {
  return TIMELINE_TYPE_META[item.lane]?.icon ?? 'i-lucide-dot';
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
    <div class="space-y-3">
      <!-- The window and the type filter: both drive the axis and the table
           below. The type chips key the lanes and a small key beside the
           window keys the other marks; a window with a single type has
           nothing to filter and keeps the full legend. -->
      <div v-if="showAxis" class="space-y-2">
        <div class="flex flex-wrap items-center gap-1">
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
          <div class="ml-auto flex flex-wrap items-center gap-x-3 gap-y-1">
            <ChartLegend v-if="showTypeFilter" :items="markKeyItems" />
          </div>
        </div>
        <TimelineTypeFilter
          v-if="showTypeFilter"
          :types="windowTypes"
          :items="windowItems"
          :hidden="hiddenTypes"
          @toggle="toggleType($event, windowTypes)"
          @only="onlyType"
          @show-all="showAllTypes"
        />
        <ChartLegend v-else :items="legendItems" />
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
              {{ TIMELINE_TYPE_META[lane].label }}
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
          <template v-for="item in shownLanes.steps" :key="item.id">
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
          <template v-for="item in shownLanes.network" :key="item.id">
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
          <template v-for="item in shownLanes.console" :key="item.id">
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
          <template v-for="item in shownLanes.dialogs" :key="item.id">
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
          <template v-for="item in shownLanes.backend" :key="item.id">
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
              {{ tickLabels[i] }}
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
        v-if="isFailedStatus(status ?? '') && mergedRows.length > 0 && tree.failingIndex === null"
        color="warning"
        variant="subtle"
        icon="i-lucide-info"
        title="The failure was not captured at step level"
        description="The test failed, but none of the recorded steps is marked failed — the error happened outside the step list."
      />

      <template v-if="steps.length > 0">
        <!-- Per-category summary strip: the test body's steps, then setup and teardown -->
        <div class="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
          <span v-if="bodyLeafIndices.length" class="font-medium text-gray-600 dark:text-gray-300"
            >{{ bodyLeafIndices.length }} step{{ bodyLeafIndices.length === 1 ? '' : 's' }}</span
          >
          <span v-else-if="bodyNeverRan" class="font-medium text-gray-600 dark:text-gray-300"
            >The test body never ran</span
          >
          <span v-else class="font-medium text-gray-600 dark:text-gray-300">No steps in the test body</span>
          <span class="text-gray-300 dark:text-gray-600">·</span>
          <span v-for="c in stepSummary" :key="c.category" class="inline-flex items-center gap-1">
            <UBadge :color="stepCategoryColor[c.category] || 'neutral'" variant="soft" size="xs">
              {{ c.category }}
            </UBadge>
            <span class="tabular-nums text-gray-500 dark:text-gray-400"
              >×{{ c.count }} · <DurationValue :ms="c.duration"
            /></span>
          </span>
          <span v-for="t in sectionTimes" :key="t.label" class="tabular-nums text-gray-500 dark:text-gray-400">
            {{ t.label }} <DurationValue :ms="t.ms" />
          </span>
        </div>

        <!-- Phone layout (below `md`): one stacked card per row, so the Step and
             Duration columns are never cut and the page never scrolls sideways.
             The `md`-and-up table below carries the same rows unchanged. -->
        <div class="md:hidden space-y-2">
          <template v-for="entry in renderList" :key="`m-${entry.key}`">
            <!-- A setup / teardown section: one row that folds its hooks and fixtures -->
            <button
              v-if="entry.kind === 'section'"
              type="button"
              class="flex w-full items-start gap-2 rounded-lg border border-default bg-elevated/40 p-2.5 text-left outline-none focus-visible:outline-2 focus-visible:outline-primary"
              :aria-expanded="entry.open ? 'true' : 'false'"
              @click="toggleSection(entry.section)"
            >
              <UIcon
                :name="entry.open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                class="mt-0.5 size-4 shrink-0 text-muted"
              />
              <span class="min-w-0 flex-1">
                <span class="flex items-center gap-2 text-sm">
                  <span class="font-medium" :class="entry.failed ? 'text-red-600 dark:text-red-400' : ''">{{
                    entry.label
                  }}</span>
                  <DurationValue :ms="entry.durationMs" class="ml-auto text-xs text-muted" />
                </span>
                <span v-if="entry.summary" class="mt-0.5 block break-words text-xs text-muted">{{
                  entry.summary
                }}</span>
              </span>
            </button>

            <!-- A step row -->
            <div
              v-else-if="entry.kind === 'step'"
              class="rounded-lg border border-default p-2.5"
              :class="entry.failing ? 'bg-red-50 dark:bg-red-950/30' : ''"
              :style="{ marginInlineStart: `${Math.min(entry.level + (entry.nested ? 1 : 0), 4) * 0.75}rem` }"
            >
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <span
                  v-if="status === 'didnotrun'"
                  class="inline-flex items-center justify-center size-5 shrink-0 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-xs leading-none"
                  title="Not run"
                  >–</span
                >
                <span
                  v-else-if="entry.failed"
                  class="inline-flex items-center justify-center size-5 shrink-0 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs leading-none"
                  :title="entry.failing ? 'Step failed' : 'The failure happened inside this step'"
                  >✗</span
                >
                <span
                  v-else
                  class="inline-flex items-center justify-center size-5 shrink-0 rounded-full bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400 text-xs leading-none"
                  title="Step passed"
                  >✓</span
                >
                <UBadge :color="stepCategoryColor[entry.step.category] || 'neutral'" variant="soft" size="xs">
                  {{ entry.step.category }}
                </UBadge>
                <UBadge
                  v-if="entry.index === slowestStepIndex"
                  color="warning"
                  variant="subtle"
                  size="xs"
                  title="Slowest step in this test"
                >
                  slowest
                </UBadge>
                <span
                  v-if="showAxis && entry.item"
                  class="ml-auto tabular-nums text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap"
                >
                  {{ formatRel(entry.item.at) }}
                </span>
              </div>
              <p
                class="mt-1.5 text-sm break-words"
                :class="entry.failing ? 'text-red-600 dark:text-red-400 font-medium' : ''"
              >
                <StepLabel :step="entry.step" />
              </p>
              <StepParamsDisclosure :params="entry.step.params" class="mt-1" />
              <ErrorText
                v-if="entry.failing && entry.step.error?.message"
                mode="block"
                :text="entry.step.error.message"
                class="mt-1"
              />
              <OpenInIdeLink
                v-if="entry.step.location"
                :location="displayLocation(entry.step.location)"
                :project-key="projectKey ?? undefined"
                :project-name="projectName ?? undefined"
                class="text-xs text-gray-400 dark:text-gray-500 mt-0.5"
              />
              <div class="mt-1.5">
                <div class="flex items-center justify-between gap-2">
                  <DurationValue
                    :ms="entry.step.duration"
                    :class="`text-sm ${stepDurationTextClass(entry.step.duration)}`"
                    unit-class="opacity-60"
                  />
                  <span
                    v-if="stepPctOfTest(entry.step.duration)"
                    class="text-xs tabular-nums text-gray-400 dark:text-gray-500"
                  >
                    {{ stepPctOfTest(entry.step.duration) }}
                  </span>
                </div>
                <div class="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                  <div
                    class="absolute inset-y-0 rounded-full"
                    :class="stepBarColorClass(entry.step.duration)"
                    :style="stepBarStyle(entry.step)"
                  />
                </div>
              </div>
              <FailingStepSnapshot
                v-if="entry.failing"
                data-shot="failing-step-evidence"
                :test-runs-case-id="testRunsCaseId"
                :attachments="attachments"
                :aria-snapshot="ariaSnapshot"
                class="mt-2.5"
              />
            </div>

            <!-- An interleaved network / console / backend row -->
            <div
              v-else
              class="rounded-lg border border-default p-2.5 cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60"
              :class="entry.item.failed ? 'bg-red-50 dark:bg-red-950/30' : ''"
              :style="entry.nested ? { marginInlineStart: '0.75rem' } : undefined"
              @click="revealItem(entry.item)"
            >
              <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
                <UIcon :name="eventIcon(entry.item)" class="size-4 shrink-0" :class="eventIconClass(entry.item)" />
                <span class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                  {{ kindTag(entry.item) || entry.item.kind }}
                </span>
                <span
                  v-if="showAxis"
                  class="ml-auto tabular-nums text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap"
                >
                  {{ formatRel(entry.item.at) }}
                </span>
              </div>
              <div class="mt-1 flex items-baseline justify-between gap-2">
                <span class="font-mono text-xs break-all text-gray-700 dark:text-gray-300">
                  {{ entry.item.label
                  }}<span v-if="entry.item.kind === 'network'" class="text-gray-500"> → {{ entry.item.status }}</span>
                </span>
                <span
                  v-if="entry.item.duration != null"
                  class="shrink-0 text-xs tabular-nums text-gray-500 dark:text-gray-400"
                >
                  {{ Math.round(entry.item.duration) }} ms
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
              <template v-for="entry in renderList" :key="entry.key">
                <!-- A setup / teardown section: one row that folds its hooks and fixtures -->
                <tr
                  v-if="entry.kind === 'section'"
                  class="bg-elevated/40 [&>td]:border-b [&>td]:border-default [&>td]:px-3 [&>td]:py-2 [&>td]:align-top"
                >
                  <td v-if="showAxis" class="tabular-nums text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {{ entry.at != null ? formatRel(entry.at) : '' }}
                  </td>
                  <td>
                    <span
                      v-if="entry.failed"
                      class="inline-flex items-center justify-center size-5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs leading-none"
                      title="The failure happened here"
                      >✗</span
                    >
                  </td>
                  <td colspan="2">
                    <button
                      type="button"
                      class="inline-flex max-w-full items-start gap-1.5 rounded text-left outline-none focus-visible:outline-2 focus-visible:outline-primary"
                      :aria-expanded="entry.open ? 'true' : 'false'"
                      @click="toggleSection(entry.section)"
                    >
                      <UIcon
                        :name="entry.open ? 'i-lucide-chevron-down' : 'i-lucide-chevron-right'"
                        class="mt-0.5 size-4 shrink-0 text-muted"
                      />
                      <span class="font-medium" :class="entry.failed ? 'text-red-600 dark:text-red-400' : ''">{{
                        entry.label
                      }}</span>
                      <span v-if="entry.summary" class="min-w-0 break-words text-xs leading-5 text-muted">{{
                        entry.summary
                      }}</span>
                    </button>
                  </td>
                  <td>
                    <DurationValue :ms="entry.durationMs" class="text-sm text-muted" unit-class="opacity-60" />
                  </td>
                </tr>

                <!-- A step row -->
                <template v-else-if="entry.kind === 'step'">
                  <tr
                    class="[&>td]:border-b [&>td]:border-default [&>td]:px-3 [&>td]:py-2 [&>td]:align-top"
                    :class="entry.failing ? 'bg-red-50 dark:bg-red-950/30' : ''"
                  >
                    <td v-if="showAxis" class="tabular-nums text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                      {{ entry.item ? formatRel(entry.item.at) : '' }}
                    </td>
                    <td>
                      <span
                        v-if="status === 'didnotrun'"
                        class="inline-flex items-center justify-center size-5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-400 dark:text-gray-500 text-xs leading-none"
                        title="Not run"
                        >–</span
                      >
                      <span
                        v-else-if="entry.failed"
                        class="inline-flex items-center justify-center size-5 rounded-full bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400 text-xs leading-none"
                        :title="entry.failing ? 'Step failed' : 'The failure happened inside this step'"
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
                      <UBadge :color="stepCategoryColor[entry.step.category] || 'neutral'" variant="soft" size="xs">
                        {{ entry.step.category }}
                      </UBadge>
                    </td>
                    <td class="min-w-0">
                      <div :style="stepIndent(entry)">
                        <div class="flex items-center gap-2">
                          <span
                            class="min-w-0 break-words"
                            :class="entry.failing ? 'text-red-600 dark:text-red-400 font-medium' : ''"
                          >
                            <StepLabel :step="entry.step" />
                          </span>
                          <UBadge
                            v-if="entry.index === slowestStepIndex"
                            color="warning"
                            variant="subtle"
                            size="xs"
                            class="shrink-0"
                            title="Slowest step in this test"
                          >
                            slowest
                          </UBadge>
                        </div>
                        <StepParamsDisclosure :params="entry.step.params" class="mt-1" />
                        <ErrorText
                          v-if="entry.failing && entry.step.error?.message"
                          mode="block"
                          :text="entry.step.error.message"
                          class="mt-1"
                        />
                        <OpenInIdeLink
                          v-if="entry.step.location"
                          :location="displayLocation(entry.step.location)"
                          :project-key="projectKey ?? undefined"
                          :project-name="projectName ?? undefined"
                          class="text-xs text-gray-400 dark:text-gray-500 mt-0.5 break-all"
                        />
                      </div>
                    </td>
                    <td>
                      <div class="min-w-[6rem]">
                        <div class="flex items-center justify-between gap-2">
                          <DurationValue
                            :ms="entry.step.duration"
                            :class="`text-sm ${stepDurationTextClass(entry.step.duration)}`"
                            unit-class="opacity-60"
                          />
                          <span
                            v-if="stepPctOfTest(entry.step.duration)"
                            class="text-xs tabular-nums text-gray-400 dark:text-gray-500"
                          >
                            {{ stepPctOfTest(entry.step.duration) }}
                          </span>
                        </div>
                        <div
                          class="relative mt-1 h-1.5 w-full overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                        >
                          <div
                            class="absolute inset-y-0 rounded-full"
                            :class="stepBarColorClass(entry.step.duration)"
                            :style="stepBarStyle(entry.step)"
                          />
                        </div>
                      </div>
                    </td>
                  </tr>
                  <!-- The page at the failing step: screenshot + ARIA, tied to the step. -->
                  <tr v-if="entry.failing">
                    <td :colspan="showAxis ? 5 : 4" class="border-b border-default px-3 pb-3 pt-0">
                      <FailingStepSnapshot
                        :test-runs-case-id="testRunsCaseId"
                        :attachments="attachments"
                        :aria-snapshot="ariaSnapshot"
                      />
                    </td>
                  </tr>
                </template>

                <!-- An interleaved network / console / backend row -->
                <tr
                  v-else
                  class="cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800/60 [&>td]:border-b [&>td]:border-default [&>td]:px-3 [&>td]:py-2 [&>td]:align-top"
                  :class="entry.item.failed ? 'bg-red-50 dark:bg-red-950/30' : ''"
                  @click="revealItem(entry.item)"
                >
                  <td v-if="showAxis" class="tabular-nums text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
                    {{ formatRel(entry.item.at) }}
                  </td>
                  <td>
                    <UIcon :name="eventIcon(entry.item)" class="size-4" :class="eventIconClass(entry.item)" />
                  </td>
                  <td class="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">
                    {{ kindTag(entry.item) || entry.item.kind }}
                  </td>
                  <td>
                    <div :style="entry.nested ? { paddingInlineStart: '1.25rem' } : undefined">
                      <span class="font-mono text-xs break-all text-gray-700 dark:text-gray-300">{{
                        entry.item.label
                      }}</span>
                      <span v-if="entry.item.kind === 'network'" class="font-mono text-xs text-gray-500">
                        → {{ entry.item.status }}</span
                      >
                    </div>
                  </td>
                  <td>
                    <span
                      v-if="entry.item.duration != null"
                      class="text-xs tabular-nums text-gray-500 dark:text-gray-400"
                    >
                      {{ Math.round(entry.item.duration) }} ms
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
