/**
 * The failure timeline: one time axis per execution that places the steps, the
 * console entries, the network requests and the backend log entries on the same
 * clock, marks the moment of failure, and picks a default window around the
 * failed step. It turns "console (1) / network (3)" — two unrelated lists — into
 * "what the app was doing when the test gave up".
 *
 * Pure assembly over rows the caller already loaded (the same rows the execution
 * detail returns), so the server route and the demo mirror build the same
 * object. Every timestamp the builder reads is epoch ms; items are positioned in
 * ms relative to `origin`. It never throws: partial, missing or malformed input
 * yields a valid (possibly empty) timeline, and anything without a usable
 * timestamp is listed in `unplaced` with a reason rather than guessed at.
 */
import { stepLabel } from '@piwitests/core/step-analysis';
import { parseCallsiteLocation } from './callsite-location';

/** The rows a lane groups. `backend` holds log entries attached to a request. */
export type TimelineLane = 'steps' | 'console' | 'network' | 'backend' | 'dialogs';

/** What an item stands for; the card colors and formats each kind differently. */
export type TimelineItemKind = 'step' | 'console' | 'network' | 'backend' | 'dialogs';

/** The page section (and index within it) an item was read from, for click-through. */
export interface TimelineRef {
  section: 'steps' | 'console' | 'networkRequests' | 'backendLogs' | 'dialogs';
  /** Index within the source list; backend logs carry their parent request's index. */
  index: number;
}

/** One frame of a step's caller chain: where in the source the call was made. */
export interface TimelineFrame {
  file: string;
  line: number;
  function: string | null;
}

/**
 * Where a step's action came from: the enclosing method (the nearest in-project
 * frame outside the spec file) plus the caller chain up to the spec. `function`
 * needs an uploaded trace; `file`/`line` come from the reporter's call site, so
 * the shallowest form is just `{ file, line, function: null, chain: [] }`.
 */
export interface TimelineOrigin {
  file: string;
  line: number;
  function: string | null;
  chain: TimelineFrame[];
}

/** One placed item, positioned at `at` ms relative to the timeline `origin`. */
export interface TimelineItem {
  id: string;
  lane: TimelineLane;
  /** Start, in ms relative to `origin`. */
  at: number;
  /** Span in ms for bars (steps, network); absent for point marks (console, backend). */
  duration?: number;
  label: string;
  /**
   * Steps only: the step's target (rendered locator or URL) when newer
   * Playwright carried it separately, for two-element rendering. `label`
   * remains the joined plain-text form.
   */
  subtitle?: string;
  /** Steps only: the step's curated params (rendered `locator`, a navigation `url`, …). */
  params?: Record<string, string | number | boolean>;
  /** Console type, HTTP status, or step/log status — kind-specific. */
  status?: string;
  kind: TimelineItemKind;
  ref: TimelineRef;
  /** The failed step, or a request that errored — drawn in the critical color. */
  failed?: boolean;
  /** Steps only: the call site the action came from, or null when unknown. */
  origin?: TimelineOrigin | null;
  /** Steps only: the enclosing `test.step` title or method name the action groups under. */
  group?: string | null;
  /** Steps only: the reporter step category (`action`, `test.step`, `hook`, …). */
  category?: string;
}

/** Something that exists but carries no usable timestamp, so it cannot be placed. */
export interface TimelineUnplaced {
  section: TimelineRef['section'];
  label: string;
  reason: string;
}

/** A view window, in ms relative to `origin`. */
export interface TimelineWindow {
  start: number;
  end: number;
}

/** The placed items grouped by lane, in the card's row order. */
export interface TimelineLanes {
  steps: TimelineItem[];
  console: TimelineItem[];
  network: TimelineItem[];
  backend: TimelineItem[];
  dialogs: TimelineItem[];
}

export interface FailureTimeline {
  /** Epoch ms of the axis start (the earliest activity, at or before `startedAt`). */
  origin: number;
  /** Epoch ms of the axis end (the latest activity end, at or after the failure). */
  end: number;
  /** The moment of failure, in ms relative to `origin`. */
  failureAt: number;
  /** The failed step, when one was identified. */
  failedStep: { index: number; label: string; at: number; duration: number } | null;
  lanes: TimelineLanes;
  unplaced: TimelineUnplaced[];
  /** True when step positions were derived from durations because start times were missing. */
  estimated: boolean;
  /** The default view: the failed step plus lead/trail, or the whole execution. */
  window: TimelineWindow;
}

/** Optional trace anchor (epoch ms): the failing action's window, used only for `failureAt`. */
export interface TimelineTraceAnchor {
  failingActionStart?: number | null;
  failingActionEnd?: number | null;
}

/** One trace action's call stack, matched to a step by its call-site `location`. */
export interface TimelineCallsite {
  /** `file:line[:col]` of the action's innermost in-project frame. */
  location: string;
  /** Frames innermost-first, with function names when the trace recorded them. */
  frames: Array<{ file: string; line: number; function?: string | null; inProject?: boolean }>;
}

export interface FailureTimelineInput {
  startedAt?: number | null;
  duration?: number | null;
  timeout?: number | null;
  status?: string | null;
  steps?: unknown;
  stepEvents?: unknown;
  consoleLogs?: unknown;
  dialogs?: unknown;
  networkRequests?: unknown;
  traceAnchor?: TimelineTraceAnchor | null;
  /** The test's spec file (project-relative) — the boundary for the "enclosing method". */
  specFile?: string | null;
  /** Per-action call stacks from the trace, matched to steps by call-site location. */
  traceCallsites?: TimelineCallsite[] | null;
}

/** The default window reaches this far before the failed step… */
export const TIMELINE_WINDOW_LEAD_MS = 10_000;
/** …and this far after it, both clamped to the execution. */
export const TIMELINE_WINDOW_TRAIL_MS = 2_000;

/** Longest label the merged list shows before the card truncates it. */
const MAX_LABEL_CHARS = 200;

type StepRow = {
  title?: unknown;
  subtitle?: unknown;
  params?: unknown;
  duration?: unknown;
  category?: unknown;
  location?: unknown;
  startTime?: unknown;
  error?: unknown;
  failed?: unknown;
};

type ConsoleRow = { type?: unknown; text?: unknown; timestamp?: unknown; location?: unknown };

type DialogRow = { type?: unknown; message?: unknown; defaultValue?: unknown; closedAt?: unknown };

type ServerLogRow = { timestamp?: unknown; level?: unknown; message?: unknown };

type NetworkRow = {
  method?: unknown;
  url?: unknown;
  status?: unknown;
  duration?: unknown;
  startTime?: unknown;
  serverLogs?: unknown;
};

type StepEventRow = { startedAt?: unknown; duration?: unknown };

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function asArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

/** Coerce a list of unknowns into row objects, dropping non-object entries to `{}`. */
function rows<T>(value: unknown): T[] {
  return asArray(value).map((entry) => (entry != null && typeof entry === 'object' ? (entry as T) : ({} as T)));
}

function str(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

/** Keep a step's params object as-is when it holds only primitive values. */
function stepParams(value: unknown): Record<string, string | number | boolean> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (typeof val === 'string' || typeof val === 'number' || typeof val === 'boolean') out[key] = val;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function clampLabel(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > MAX_LABEL_CHARS ? `${trimmed.slice(0, MAX_LABEL_CHARS - 1)}…` : trimmed;
}

/** A step is "failed" when it carries an error or a truthy `failed` flag. */
function stepFailed(step: StepRow): boolean {
  if (step.failed === true) return true;
  const error = step.error;
  if (typeof error === 'string') return error.trim().length > 0;
  return error != null && typeof error === 'object';
}

const FAILED_STATUSES = new Set(['failed', 'timedout', 'timedOut', 'interrupted']);

function normalizeSlashes(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '');
}

/** A `file:line` key for matching a step's call site to a trace action (column ignored). */
function fileLineKey(location: string | null | undefined): string | null {
  const parsed = parseCallsiteLocation(location);
  return parsed ? `${normalizeSlashes(parsed.file)}:${parsed.line}` : null;
}

/**
 * Where a step's action came from. With trace frames: the enclosing method is
 * the nearest in-project frame outside the spec file, and `chain` is the callers
 * above it up to the spec. Without frames: the reporter's own call-site
 * `location` gives file and line, with no function name.
 */
function deriveOrigin(
  location: string | null | undefined,
  frames: TimelineCallsite['frames'] | null,
  specFile: string | null,
): TimelineOrigin | null {
  const spec = specFile ? normalizeSlashes(specFile) : null;
  if (frames && frames.length > 0) {
    const norm = frames
      .filter((f) => f && typeof f.file === 'string' && isFiniteNumber(f.line))
      .map((f) => ({
        file: normalizeSlashes(f.file),
        line: f.line,
        function: typeof f.function === 'string' ? f.function : null,
        inProject: f.inProject !== false,
      }));
    if (norm.length > 0) {
      const inProject = norm.filter((f) => f.inProject);
      const pool = inProject.length > 0 ? inProject : norm;
      let enclosingIdx = spec ? pool.findIndex((f) => f.file !== spec) : 0;
      if (enclosingIdx === -1) enclosingIdx = 0;
      const enclosing = pool[enclosingIdx]!;
      const chain = pool.slice(enclosingIdx + 1).map((f) => ({ file: f.file, line: f.line, function: f.function }));
      return { file: enclosing.file, line: enclosing.line, function: enclosing.function, chain };
    }
  }
  const parsed = parseCallsiteLocation(location);
  if (parsed) return { file: normalizeSlashes(parsed.file), line: parsed.line, function: null, chain: [] };
  return null;
}

export function buildFailureTimeline(input: FailureTimelineInput): FailureTimeline {
  const steps = rows<StepRow>(input.steps);
  const consoleLogs = rows<ConsoleRow>(input.consoleLogs);
  const dialogs = rows<DialogRow>(input.dialogs);
  const networkRequests = rows<NetworkRow>(input.networkRequests);
  const stepEvents = rows<StepEventRow>(input.stepEvents);

  const startedAt = isFiniteNumber(input.startedAt) ? input.startedAt : null;
  const duration = isFiniteNumber(input.duration) && input.duration >= 0 ? input.duration : null;

  // Steps have reliable start times only when *every* step carries one; a mixed
  // list cannot be interleaved, so it is placed cumulatively and flagged estimated.
  const stepsHaveStartTimes = steps.length > 0 && steps.every((s) => isFiniteNumber(s.startTime));

  // The origin is the earliest epoch timestamp anywhere in the execution, so no
  // item ever lands before t+0. `startedAt` anchors it; captured timestamps that
  // predate it (or stand in when it is missing) pull it earlier.
  const originCandidates: number[] = [];
  if (startedAt != null) originCandidates.push(startedAt);
  if (stepsHaveStartTimes) for (const s of steps) originCandidates.push(s.startTime as number);
  for (const e of stepEvents) if (isFiniteNumber(e.startedAt)) originCandidates.push(e.startedAt);
  for (const c of consoleLogs) if (isFiniteNumber(c.timestamp)) originCandidates.push(c.timestamp);
  for (const d of dialogs) if (isFiniteNumber(d.closedAt)) originCandidates.push(d.closedAt);
  for (const n of networkRequests) if (isFiniteNumber(n.startTime)) originCandidates.push(n.startTime);
  for (const n of networkRequests)
    for (const log of rows<ServerLogRow>(n.serverLogs))
      if (isFiniteNumber(log.timestamp)) originCandidates.push(log.timestamp);
  const origin = originCandidates.length > 0 ? Math.min(...originCandidates) : 0;

  const lanes: TimelineLanes = { steps: [], console: [], network: [], backend: [], dialogs: [] };
  const unplaced: TimelineUnplaced[] = [];
  let latestEnd = 0;
  const noteEnd = (at: number, dur = 0) => {
    if (at + dur > latestEnd) latestEnd = at + dur;
  };

  // ── Steps lane ─────────────────────────────────────────────────────────────
  // Real start times when present; otherwise cumulative from `startedAt` and the
  // step durations, which is an estimate the UI is told about.
  const estimated = steps.length > 0 && !stepsHaveStartTimes;
  let cursor = startedAt ?? origin;
  const failedStepIndex = (() => {
    const explicit = steps.findIndex((s) => stepFailed(s));
    if (explicit !== -1) return explicit;
    // The last step of a failed execution is the failure when nothing is marked.
    if (steps.length > 0 && FAILED_STATUSES.has(str(input.status))) return steps.length - 1;
    return null;
  })();

  // Position every step first (real or cumulative), so `test.step` group spans
  // are known before each action is asked which one contains it.
  const positions: Array<{ at: number; dur: number }> = [];
  steps.forEach((step) => {
    const dur = isFiniteNumber(step.duration) && step.duration >= 0 ? step.duration : 0;
    const absStart = stepsHaveStartTimes ? (step.startTime as number) : cursor;
    if (!stepsHaveStartTimes) cursor += dur;
    positions.push({ at: absStart - origin, dur });
  });

  // `test.step` groups: an action's group is the innermost test.step whose span
  // contains it (a test.step contains itself, so it heads its own group).
  const testStepSpans = steps
    .map((step, index) => ({ index, title: clampLabel(stepLabel(step)), ...positions[index]! }))
    .filter((s) => str(steps[s.index]!.category) === 'test.step' && s.title.length > 0);
  const groupTitleFor = (at: number, dur: number): string | null => {
    const mid = at + dur / 2;
    let best: { title: string; width: number } | null = null;
    for (const span of testStepSpans) {
      if (span.at <= mid && mid <= span.at + span.dur) {
        const width = span.dur;
        if (!best || width < best.width) best = { title: span.title, width };
      }
    }
    return best?.title ?? null;
  };

  // Match each step to a trace action's frames by call-site file:line.
  const callsiteByKey = new Map<string, TimelineCallsite['frames']>();
  for (const cs of asArray(input.traceCallsites) as TimelineCallsite[]) {
    const key = fileLineKey(cs?.location);
    if (key && Array.isArray(cs.frames) && !callsiteByKey.has(key)) callsiteByKey.set(key, cs.frames);
  }
  const specFile = typeof input.specFile === 'string' ? input.specFile : null;

  let failedStep: FailureTimeline['failedStep'] = null;
  steps.forEach((step, index) => {
    const { at, dur } = positions[index]!;
    const failed = index === failedStepIndex;
    const label = clampLabel(stepLabel(step) || `Step ${index + 1}`);
    const location = typeof step.location === 'string' ? step.location : null;
    const frames = (location && callsiteByKey.get(fileLineKey(location) ?? '')) || null;
    const stepOrigin = deriveOrigin(location, frames, specFile);
    const group = groupTitleFor(at, dur) ?? stepOrigin?.function ?? null;
    const subtitle = typeof step.subtitle === 'string' && step.subtitle.trim().length > 0 ? step.subtitle.trim() : null;
    const params = stepParams(step.params);
    lanes.steps.push({
      id: `step-${index}`,
      lane: 'steps',
      at,
      duration: dur,
      label,
      status: failed ? 'failed' : 'passed',
      kind: 'step',
      ref: { section: 'steps', index },
      origin: stepOrigin,
      group,
      ...(subtitle ? { subtitle } : {}),
      ...(params ? { params } : {}),
      ...(str(step.category) ? { category: str(step.category) } : {}),
      ...(failed ? { failed: true } : {}),
    });
    noteEnd(at, dur);
    if (failed) failedStep = { index, label, at, duration: dur };
  });

  // ── Console lane ───────────────────────────────────────────────────────────
  consoleLogs.forEach((entry, index) => {
    const label = clampLabel(str(entry.text));
    if (!isFiniteNumber(entry.timestamp)) {
      unplaced.push({ section: 'console', label: label || `Console entry ${index + 1}`, reason: 'no timestamp' });
      return;
    }
    const at = entry.timestamp - origin;
    lanes.console.push({
      id: `console-${index}`,
      lane: 'console',
      at,
      label,
      status: str(entry.type, 'log'),
      kind: 'console',
      ref: { section: 'console', index },
    });
    noteEnd(at);
  });

  // ── Dialogs lane ───────────────────────────────────────────────────────────
  dialogs.forEach((dialog, index) => {
    const type = str(dialog.type, 'dialog');
    const message = clampLabel(str(dialog.message));
    const label = message ? `${type}: ${message}` : type;
    if (!isFiniteNumber(dialog.closedAt)) {
      unplaced.push({ section: 'dialogs', label: label || `Dialog ${index + 1}`, reason: 'no timestamp' });
      return;
    }
    const at = dialog.closedAt - origin;
    lanes.dialogs.push({
      id: `dialog-${index}`,
      lane: 'dialogs',
      at,
      label,
      status: type,
      kind: 'dialogs',
      ref: { section: 'dialogs', index },
    });
    noteEnd(at);
  });

  // ── Network + backend lanes ────────────────────────────────────────────────
  networkRequests.forEach((req, index) => {
    const method = str(req.method, 'GET');
    const url = str(req.url);
    const label = clampLabel(`${method} ${url}`.trim());
    const httpStatus = isFiniteNumber(req.status) ? req.status : 0;
    const dur = isFiniteNumber(req.duration) && req.duration >= 0 ? req.duration : 0;

    if (isFiniteNumber(req.startTime)) {
      const at = req.startTime - origin;
      lanes.network.push({
        id: `network-${index}`,
        lane: 'network',
        at,
        duration: dur,
        label,
        status: String(httpStatus),
        kind: 'network',
        ref: { section: 'networkRequests', index },
        ...(httpStatus >= 400 || httpStatus <= 0 ? { failed: true } : {}),
      });
      noteEnd(at, dur);
    } else {
      unplaced.push({
        section: 'networkRequests',
        label: label || `Request ${index + 1}`,
        reason: 'no start time recorded',
      });
    }

    // Backend log entries carry their own epoch timestamp and hang off the
    // request; a click on one reveals the network card the request lives in.
    rows<ServerLogRow>(req.serverLogs).forEach((log, logIndex) => {
      const message = clampLabel(str(log.message));
      if (!isFiniteNumber(log.timestamp)) {
        unplaced.push({
          section: 'backendLogs',
          label: message || `Backend log ${logIndex + 1}`,
          reason: 'no timestamp',
        });
        return;
      }
      const at = log.timestamp - origin;
      lanes.backend.push({
        id: `backend-${index}-${logIndex}`,
        lane: 'backend',
        at,
        label: message,
        status: str(log.level, 'info'),
        kind: 'backend',
        ref: { section: 'backendLogs', index },
      });
      noteEnd(at);
    });
  });

  // ── Failure moment ─────────────────────────────────────────────────────────
  // The failed step's end, else the trace anchor's end, else startedAt+duration.
  const anchorEnd = isFiniteNumber(input.traceAnchor?.failingActionEnd)
    ? (input.traceAnchor!.failingActionEnd as number)
    : null;
  let failureAt: number;
  if (failedStep) {
    failureAt = (failedStep as { at: number; duration: number }).at + (failedStep as { duration: number }).duration;
  } else if (anchorEnd != null) {
    failureAt = anchorEnd - origin;
  } else if (startedAt != null && duration != null) {
    failureAt = startedAt + duration - origin;
  } else {
    failureAt = latestEnd;
  }
  failureAt = Math.max(0, failureAt);
  noteEnd(failureAt);

  // ── Axis bounds and default window ─────────────────────────────────────────
  if (startedAt != null && duration != null) noteEnd(startedAt + duration - origin);
  const span = Math.max(latestEnd, failureAt, 0);
  const end = origin + span;

  const clamp = (value: number) => Math.max(0, Math.min(span, value));
  const window: TimelineWindow = failedStep
    ? {
        start: clamp((failedStep as { at: number }).at - TIMELINE_WINDOW_LEAD_MS),
        end: clamp(
          (failedStep as { at: number; duration: number }).at +
            (failedStep as { duration: number }).duration +
            TIMELINE_WINDOW_TRAIL_MS,
        ),
      }
    : { start: 0, end: span };

  return { origin, end, failureAt, failedStep, lanes, unplaced, estimated, window };
}
