/**
 * What the editor service learns about runs as they happen. One event stream per instance and key says when a run of
 * a context's project starts or ends: half a second after a run ends, the context reads its latest run again, and
 * while a run of its branch is in progress, the context follows it (`live`), counted through that run's own stream.
 * A test run the editor starts carries a ref (`PIWI_ORIGIN_REF`), which the service looks for on the instance for two
 * minutes, and in every run the stream announces: the context follows that run wherever it runs and keeps it as its own
 * (`ownRuns`), and so a later run with the same ref, a rerun of the command. A command that ended without its run
 * reaching the instance is said in a notice.
 */
import { randomBytes } from 'node:crypto';
import type { PiwiConnection } from '@piwitests/core/dotenv';
import { parseRunOrigin, RUN_ORIGIN_METADATA_KEY } from '@piwitests/core/wire';
import type { PiwiContext } from './context.js';
import type { RunDetails } from './piwi-client.js';
import type { LiveRun, Notice } from './protocol.js';
import {
  EventStream,
  InstanceStream,
  isRunEvent,
  type EventStreamOptions,
  type InstanceEvent,
  type RunEvent,
} from './run-stream.js';

const ACTIVE = new Set(['running', 'initializing', 'finalizing']);
/** The wait after a run ends before its context reads the latest run again: runs that end together are read once. */
const SETTLE_MS = 500;
/** While a run is live, the client hears of it at most this often. */
const PROGRESS_MS = 300;
/** How often, and for how long, the instance is asked for the run of a command the editor built. */
const OWN_RUN_POLL_MS = 2_000;
const OWN_RUN_WATCH_MS = 2 * 60_000;
/** The commands whose runs the service recognizes, the latest ones: past this many, the oldest is forgotten. */
const MAX_WATCHES = 50;
/** How long after a command ends its run may take to show on the instance. */
const COMMAND_END_WAIT_MS = 5_000;
/** How long the counts of a test's end may take to follow it; without them, how often the run's details are read. */
const COUNTS_WAIT_MS = 1_000;
const DETAILS_MS = 5_000;

/** A ref for a run the editor starts: `ed-` and 8 random hexadecimal characters. */
export function newRunRef(): string {
  return `ed-${randomBytes(4).toString('hex')}`;
}

/** The ref an editor stamped on a run; null for a run another launcher started. */
function editorRef(run: RunDetails): string | null {
  const origin = parseRunOrigin(run.metadata?.[RUN_ORIGIN_METADATA_KEY]);
  return origin?.kind === 'editor' ? (origin.ref ?? null) : null;
}

/** A run's counts as the status bars show them, from its details or an event of its stream; null without counts. */
function countsOf(data: Record<string, unknown>): Pick<LiveRun, 'done' | 'total' | 'failed'> | null {
  if (typeof data.totalTests !== 'number' && typeof data.passedTests !== 'number') return null;
  const n = (key: string) => (typeof data[key] === 'number' ? (data[key] as number) : 0);
  const done = n('passedTests') + n('failedTests') + n('flakyTests') + n('skippedTests') + n('didNotRunTests');
  return { done, total: Math.max(n('totalTests'), done), failed: n('failedTests') };
}

function liveOf(run: RunDetails, own: boolean): LiveRun {
  return {
    runId: run.id,
    status: run.status,
    ...(countsOf(run as unknown as Record<string, unknown>) ?? { done: 0, total: 0, failed: 0 }),
    startedAt: run.startTime,
    own,
  };
}

const streamKey = (connection: PiwiConnection) => `${connection.serverUrl}\n${connection.apiKey ?? ''}`;

const sleep = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms).unref?.();
  });

export interface RunWatchOptions {
  /** The service's contexts. */
  contexts: () => readonly PiwiContext[];
  /** A context's latest run, its failures or its live run changed, or a stream connected or dropped. */
  changed: () => void;
  /** A sentence for the client to show once. */
  notice: (notice: Notice) => void;
  /** The streams' timings. */
  stream?: EventStreamOptions;
  /** How often the instance is asked for the run of a command the editor built. */
  ownRunPollMs?: number;
  /** How long after a command ends its run may take to reach the instance. */
  commandEndWaitMs?: number;
}

/** A command built with a ref, and the runs carrying that ref the instance holds. */
interface RefWatch {
  context: PiwiContext;
  ref: string;
  /** The instance and project the command reports to. */
  serverUrl: string;
  projectId: number;
  /**
   * Runs that are not the command's next one: its runs before the one found, which a rerun with the same ref follows,
   * and a run an instance answered without the ref.
   */
  known: Set<number>;
  /** The command's run found last; null until the first is found, and once the command ended. */
  found: number | null;
  /** Until when the instance is asked for the command's run: two minutes after the command was built. */
  until: number;
  timer: ReturnType<typeof setTimeout> | null;
}

/** The live run of a context, followed through its own stream. */
interface Followed {
  runId: number;
  stream: EventStream;
  /** Set while a test's end waits for the counts that follow it. */
  countsTimer: ReturnType<typeof setTimeout> | null;
  /** When the run's details were last read for its counts. */
  detailsAt: number;
}

/**
 * One per service: the event streams of the instances the contexts read, the run each context follows, and the latest
 * commands built with a ref, whose runs are the editor's own, a rerun with the same ref included.
 */
export class RunWatch {
  private readonly streams = new Map<string, InstanceStream>();
  private readonly watches = new Map<string, RefWatch>();
  private readonly followed = new Map<PiwiContext, Followed>();
  private readonly settling = new Map<PiwiContext, { timer: ReturnType<typeof setTimeout>; ended: Set<number> }>();
  private progressTimer: ReturnType<typeof setTimeout> | null = null;
  private progressAt = 0;
  private disposed = false;

  constructor(private readonly options: RunWatchOptions) {}

  /** One stream per instance and key the contexts read: the new ones are opened, those no context reads closed. */
  sync(): void {
    if (this.disposed) return;
    const wanted = new Map<string, PiwiConnection>();
    for (const c of this.options.contexts()) {
      if (c.client && c.project) wanted.set(streamKey(c.client.connection), c.client.connection);
    }
    for (const [key, stream] of this.streams) {
      if (wanted.has(key)) continue;
      stream.close();
      this.streams.delete(key);
    }
    for (const [key, connection] of wanted) {
      if (this.streams.has(key)) continue;
      const stream = new InstanceStream(
        connection,
        (event) => this.onEvent(key, event),
        () => this.options.changed(),
        this.options.stream,
      );
      this.streams.set(key, stream);
    }
    // A context that reads another instance or project follows none of the runs of the one before.
    for (const [context, followed] of this.followed) {
      if (context.live?.runId !== followed.runId) this.unfollow(context);
    }
  }

  /** Whether the stream of the instance the context reads is connected. */
  isConnected(context: PiwiContext): boolean {
    return !!context.client && !!this.streams.get(streamKey(context.client.connection))?.connected;
  }

  /** Open again the streams the instance refused: the credentials changed. */
  retryRefused(): void {
    for (const stream of this.streams.values()) if (stream.refused) stream.retry();
  }

  /**
   * Look for the run of a command built for `context` with `ref`: on the instance for two minutes, and in the runs the
   * stream announces for as long as the service keeps the command, one of the latest `MAX_WATCHES`.
   */
  watch(context: PiwiContext, ref: string): void {
    if (this.disposed || !context.client || !context.project) return;
    const w: RefWatch = {
      context,
      ref,
      serverUrl: context.client.connection.serverUrl,
      projectId: context.project.id,
      known: new Set(),
      found: null,
      until: Date.now() + OWN_RUN_WATCH_MS,
      timer: null,
    };
    this.watches.set(ref, w);
    for (const [oldest, dropped] of this.watches) {
      if (this.watches.size <= MAX_WATCHES) break;
      if (dropped.timer) clearTimeout(dropped.timer);
      this.watches.delete(oldest);
    }
    this.lookLater(w);
  }

  /**
   * The command built with `ref` was sent to a terminal. When the terminal's environment holds another ref,
   * `terminalRef`, the command's run carries that one: the command's own watch is dropped, so the instance is not asked
   * for `ref`, and the run is the editor's own when the stream announces it with `terminalRef`, whose watch counts as
   * one of the latest.
   */
  commandStarted(ref: string, terminalRef?: string | null): void {
    if (!terminalRef || terminalRef === ref) return;
    const w = this.watches.get(ref);
    if (w) {
      if (w.timer) clearTimeout(w.timer);
      w.timer = null;
      w.until = 0;
      this.watches.delete(ref);
    }
    const terminal = this.watches.get(terminalRef);
    if (terminal) {
      this.watches.delete(terminalRef);
      this.watches.set(terminalRef, terminal);
    }
  }

  /**
   * A command built with `ref` ended: its context reads its latest run and its live run once more, and, when no run of
   * the command was found, the instance is asked for one for a few seconds more; without one, a notice says so. The
   * instance is not asked again: the run found joins the command's known runs, and a rerun of the command, with the
   * same ref, is a run the stream announces.
   */
  async commandEnded(ref: string, exitCode: number | null): Promise<void> {
    const w = this.watches.get(ref);
    if (!w || !this.current(w)) return;
    if (w.timer) clearTimeout(w.timer);
    w.timer = null;
    w.until = 0;
    const { context } = w;
    // The run of the command that ended; a rerun the stream announces meanwhile is the run found after it.
    let ended = w.found;
    const live = context.live;
    this.settle(context, live && (await this.readLive(context)) ? live.runId : undefined);
    const deadline = Date.now() + (this.options.commandEndWaitMs ?? COMMAND_END_WAIT_MS);
    while (ended === null && this.current(w)) {
      const run = await this.lookup(w);
      if (run) {
        this.found(w, run);
        ended = run.id;
      } else if (Date.now() < deadline) {
        await sleep(Math.min(1_000, deadline - Date.now()));
      } else {
        break;
      }
    }
    if (!this.current(w)) return;
    if (ended === null) {
      const code = exitCode === null || exitCode === undefined ? '' : ` (exit code ${exitCode})`;
      this.options.notice({
        root: context.root,
        severity: 'warning',
        message: `The run ended${code} but did not reach ${w.serverUrl}: is the Piwi reporter in the Playwright config?`,
      });
    } else {
      w.known.add(ended);
    }
    if (w.found === ended) w.found = null;
  }

  /** Read the context's live run again, for its counts; true when it ended. */
  async readLive(context: PiwiContext): Promise<boolean> {
    const live = context.live;
    const client = context.client;
    if (!live || !client) return false;
    const run = await client.runDetails(live.runId).catch(() => null);
    if (!run || context.live?.runId !== live.runId) return false;
    if (!ACTIVE.has(run.status)) return true;
    context.live = liveOf(run, live.own);
    this.progress();
    return false;
  }

  /** The context's live run ended: the context follows none. */
  end(context: PiwiContext): void {
    context.live = null;
    this.unfollow(context);
  }

  dispose(): void {
    this.disposed = true;
    for (const stream of this.streams.values()) stream.close();
    this.streams.clear();
    for (const context of this.followed.keys()) this.unfollow(context);
    for (const w of this.watches.values()) if (w.timer) clearTimeout(w.timer);
    for (const pending of this.settling.values()) clearTimeout(pending.timer);
    this.settling.clear();
    if (this.progressTimer) clearTimeout(this.progressTimer);
  }

  private onEvent(key: string, event: InstanceEvent): void {
    for (const context of this.options.contexts()) {
      if (!context.client || context.project?.id !== event.projectId) continue;
      if (streamKey(context.client.connection) !== key) continue;
      switch (event.type) {
        case 'run-started':
        case 'run-initializing':
          void this.started(context, event.runId);
          break;
        case 'run-finalizing':
          if (context.live?.runId === event.runId) {
            context.live = { ...context.live, status: 'finalizing' };
            this.progress();
          }
          break;
        case 'run-finished':
        case 'run-submitted':
        case 'run-cancelled':
          this.settle(context, event.runId);
          break;
      }
    }
  }

  /**
   * A run of the context's project started. A run carrying the ref of a command built for the context is that
   * command's run, the editor's own, when it is neither the run found last nor one of the command's known runs: its
   * first run, or a rerun with the same ref, whatever was found before. Any other run is followed when it runs on the
   * context's branch.
   */
  private async started(context: PiwiContext, runId: number): Promise<void> {
    const client = context.client;
    if (!client || context.live?.runId === runId) return;
    const run = await client.runDetails(runId).catch(() => null);
    if (!run || this.disposed || context.client?.connection.serverUrl !== client.connection.serverUrl) return;
    const ref = editorRef(run);
    const w = ref ? this.watches.get(ref) : undefined;
    if (w && w.context === context && this.current(w)) {
      if (w.found !== run.id && !w.known.has(run.id)) this.found(w, run);
      return;
    }
    if (run.branch && (run.branch === context.runBranch || run.branch === context.checkedOutBranch)) {
      this.follow(context, run, false);
    }
  }

  /**
   * Follow a run in progress as the context's live run, the editor's own before any other; a run that already ended
   * is read with the context's latest run instead.
   */
  private follow(context: PiwiContext, run: RunDetails, own: boolean): void {
    if (!ACTIVE.has(run.status)) {
      this.settle(context, run.id);
      return;
    }
    if (context.live?.own && !own && context.live.runId !== run.id) return;
    context.live = liveOf(run, own);
    if (this.followed.get(context)?.runId !== run.id) this.followStream(context, run.id);
    this.progress();
  }

  private followStream(context: PiwiContext, runId: number): void {
    this.unfollow(context);
    const client = context.client;
    if (!client) return;
    this.followed.set(context, {
      runId,
      stream: new EventStream(
        (signal) => client.runEvents(runId, signal),
        (data) => {
          if (isRunEvent(data)) this.onRunEvent(context, runId, data);
        },
        undefined,
        { ...this.options.stream, notFoundRetryMs: null },
      ),
      countsTimer: null,
      detailsAt: 0,
    });
  }

  private unfollow(context: PiwiContext): void {
    const followed = this.followed.get(context);
    if (!followed) return;
    followed.stream.close();
    if (followed.countsTimer) clearTimeout(followed.countsTimer);
    this.followed.delete(context);
  }

  /**
   * An event of the live run's stream. `init`, `run-progress` and `run-finished` carry its counts; a test's end
   * (`test-completed`) does not, and the counts of its batch follow it. `run-finished` with a final status ends it: an
   * initializing run's stream says `run-finished` with its status, then closes, and is opened again.
   */
  private onRunEvent(context: PiwiContext, runId: number, event: RunEvent): void {
    const followed = this.followed.get(context);
    if (!context.live || context.live.runId !== runId || followed?.runId !== runId) return;
    const status = typeof event.data.status === 'string' ? event.data.status : null;
    const counts = countsOf(event.data);
    if (counts) {
      if (followed.countsTimer) clearTimeout(followed.countsTimer);
      followed.countsTimer = null;
      context.live = { ...context.live, ...counts };
    } else if (event.type === 'test-completed') {
      this.countLater(context, followed);
    }
    if (event.type === 'run-finalizing') context.live = { ...context.live, status: 'finalizing' };
    else if (status && ACTIVE.has(status)) context.live = { ...context.live, status };
    if (event.type === 'run-finished' && status && !ACTIVE.has(status)) {
      this.unfollow(context);
      this.settle(context, runId);
    }
    this.progress();
  }

  /** The counts after a test's end, from the run's details when no event brings them, at most every 5 s. */
  private countLater(context: PiwiContext, followed: Followed): void {
    if (followed.countsTimer) return;
    const wait = Math.max(COUNTS_WAIT_MS, followed.detailsAt + DETAILS_MS - Date.now());
    followed.countsTimer = setTimeout(() => {
      followed.countsTimer = null;
      followed.detailsAt = Date.now();
      const runId = followed.runId;
      void this.readLive(context).then((ended) => {
        if (ended) this.settle(context, runId);
      });
    }, wait);
    followed.countsTimer.unref?.();
  }

  /** Tell the client the live runs moved, at most every `PROGRESS_MS`. */
  private progress(): void {
    if (this.progressTimer || this.disposed) return;
    this.progressTimer = setTimeout(
      () => {
        this.progressTimer = null;
        this.progressAt = Date.now();
        this.options.changed();
      },
      Math.max(0, this.progressAt + PROGRESS_MS - Date.now()),
    );
    this.progressTimer.unref?.();
  }

  /**
   * A run of the context's project ended: the context reads its latest run again once no other run ended for
   * `SETTLE_MS`, and its live run, among the ones that ended, goes in the same change.
   */
  private settle(context: PiwiContext, runId?: number): void {
    if (this.disposed) return;
    const pending = this.settling.get(context);
    const ended = pending?.ended ?? new Set<number>();
    if (pending) clearTimeout(pending.timer);
    if (runId !== undefined) ended.add(runId);
    const timer = setTimeout(async () => {
      this.settling.delete(context);
      await context.refreshRun();
      if (this.disposed) return;
      if (context.live && ended.has(context.live.runId)) this.end(context);
      this.options.changed();
    }, SETTLE_MS);
    timer.unref?.();
    this.settling.set(context, { timer, ended });
  }

  private lookLater(w: RefWatch): void {
    w.timer = setTimeout(() => {
      w.timer = null;
      void this.look(w);
    }, this.options.ownRunPollMs ?? OWN_RUN_POLL_MS);
    w.timer.unref?.();
  }

  private async look(w: RefWatch): Promise<void> {
    if (w.found !== null || !this.current(w)) return;
    const run = await this.lookup(w);
    if (w.found !== null || !this.current(w)) return;
    if (run) this.found(w, run);
    else if (Date.now() < w.until && !w.timer) this.lookLater(w);
  }

  /** Whether the watch's context still reads the instance and the project the command reports to. */
  private current(w: RefWatch): boolean {
    return (
      !this.disposed && w.context.client?.connection.serverUrl === w.serverUrl && w.context.project?.id === w.projectId
    );
  }

  /** The run carrying the watch's ref that is not one of its known runs, when the instance holds it. */
  private async lookup(w: RefWatch): Promise<RunDetails | null> {
    const client = w.context.client;
    if (!client || !this.current(w)) return null;
    const latest = await client.latestRunByRef(w.projectId, 'editor', w.ref).catch(() => null);
    if (typeof latest?.id !== 'number' || w.known.has(latest.id)) return null;
    const run = await client.runDetails(latest.id).catch(() => null);
    if (!run) return null;
    // An instance that does not read the parameters answers its latest run, whatever launched it.
    if (editorRef(run) !== w.ref) {
      w.known.add(run.id);
      return null;
    }
    return w.known.has(run.id) ? null : run;
  }

  /**
   * The command's run is on the instance: the editor's own, followed while it runs. The run found before it, which a
   * rerun follows, joins the known runs.
   */
  private found(w: RefWatch, run: RunDetails): void {
    if (w.found === run.id || w.known.has(run.id)) return;
    if (w.found !== null) w.known.add(w.found);
    w.found = run.id;
    if (w.timer) clearTimeout(w.timer);
    w.timer = null;
    w.context.ownRuns.add(run.id);
    this.follow(w.context, run, true);
  }
}
