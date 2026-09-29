/**
 * The command line's side of a flake-lab arm: how it asks Playwright to run
 * the arm, how it counts the attempts the results file records, and the rules
 * that decide when an arm stops. Pure, so `piwi flake` stays a thin loop.
 *
 * An arm runs in batches (`--repeat-each` of a few runs each) rather than with
 * Playwright's `--max-failures`, which counts every failure: the lab stops at
 * matching failures only. The attempts of all batches are read in start order
 * and cut after the failure that reached the stop, so a batch that ran past it
 * counts exactly as a run that stopped there.
 */
import {
  FLAKE_BATCH_RUNS,
  type FlakeAfterCondition,
  type FlakeAlongsideCondition,
  type FlakeCondition,
  type FlakeResultLine,
  type FlakeTestRef,
  type FlakePlanTest,
} from '@piwitests/core/flake-plan';
import { flakeArmVerdict, flakeFixVerified, type FlakeVerdict } from '@piwitests/core/flake-verdict';

export { FLAKE_BATCH_RUNS, estimateFlakeSessionMs as estimateMs } from '@piwitests/core/flake-plan';

/** A plan's arm as the dashboard returns it. */
export interface LabArm {
  id: string;
  label: string;
  suspectId: string | null;
  rank: number | null;
  conditions: FlakeCondition[];
  runs: number;
  /** Stop at this many matching failures; null runs every run. */
  stopAt: number | null;
}

/** The experiment plan the dashboard returns (`GET /api/test-cases/:id/flake-plan`). */
export interface LabPlan {
  version: 1;
  experimentId: string | null;
  kind: 'reproduce' | 'verify';
  projectId: number;
  testCaseId: number;
  test: FlakePlanTest;
  displayTitle: string;
  windowDays: number;
  failures: number;
  passes: number;
  failureCommit: string | null;
  medianDurationMs: number | null;
  errorSignatures: string[];
  suspects: Array<{
    rank: number;
    id: string;
    label: string;
    sentence: string;
    counts: { failuresWith: number; failures: number; passesWith: number; passes: number };
    conditionLabel: string;
    sharedRoutes?: string[];
    skipped: string | null;
  }>;
  control: LabArm;
  arms: LabArm[];
  combined: LabArm | null;
  verifies: {
    experimentId: number;
    armId: number;
    label: string;
    rate: number;
    commit: string | null;
    finishedAt: string | null;
  } | null;
}

/** What one arm measured. */
export interface ArmCount {
  /** Rounds counted: the target's attempts that ran as the arm asked. */
  runs: number;
  /** Failures with a signature from history. */
  matchingFailures: number;
  /** Failures with another signature, shown apart. */
  otherFailures: number;
  /** Rounds left out: an `alongside` round without overlap, an `after` round in the other order. */
  discardedRounds: number;
  /** The arm reached its stop before its last run. */
  stoppedEarly: boolean;
  /** Signatures of the other failures, most frequent first. */
  otherSignatures: string[];
}

const FAILED = new Set(['failed', 'timedOut']);

function overlaps(a: FlakeResultLine, b: FlakeResultLine): boolean {
  return a.startedAt < b.startedAt + b.duration && b.startedAt < a.startedAt + a.duration;
}

/** The `alongside` or `after` condition of an arm, if any. */
export function workerCondition(conditions: FlakeCondition[]): FlakeAlongsideCondition | FlakeAfterCondition | null {
  for (const c of conditions) if (c.kind === 'alongside' || c.kind === 'after') return c;
  return null;
}

/**
 * Whether a target attempt ran as its arm asked: with an `alongside`
 * condition, a companion attempt overlapped it in time; with `after`, the
 * attempt that ran last before it was a companion's (in start order, as the
 * arm runs on one worker). Any other arm keeps every attempt.
 */
export function roundKept(line: FlakeResultLine, all: FlakeResultLine[], conditions: FlakeCondition[]): boolean {
  const condition = workerCondition(conditions);
  if (!condition) return true;
  if (condition.kind === 'alongside') return all.some((l) => l.role === 'companion' && overlaps(l, line));
  const before = all
    .filter((l) => l !== line && l.startedAt < line.startedAt)
    .sort((a, b) => b.startedAt - a.startedAt)[0];
  return before?.role === 'companion';
}

/**
 * Count an arm from the results lines of its batches (one list per Playwright
 * invocation, in the order they ran): the target's attempts in start order,
 * without skipped or interrupted ones and without rounds that did not run as
 * the arm asked (judged within their own batch), cut after the failure that
 * reaches `stopAt` matching failures.
 */
export function countArm(batches: FlakeResultLine[][], arm: Pick<LabArm, 'conditions' | 'stopAt'>): ArmCount {
  let seen = 0;
  const kept: FlakeResultLine[] = [];
  for (const lines of batches) {
    const targets = lines
      .filter((l) => l.role === 'target' && l.status !== 'skipped' && l.status !== 'interrupted')
      .sort((a, b) => a.startedAt - b.startedAt || a.repeatEachIndex - b.repeatEachIndex);
    seen += targets.length;
    kept.push(...targets.filter((l) => roundKept(l, lines, arm.conditions)));
  }
  const count: ArmCount = {
    runs: 0,
    matchingFailures: 0,
    otherFailures: 0,
    discardedRounds: seen - kept.length,
    stoppedEarly: false,
    otherSignatures: [],
  };
  const others = new Map<string, number>();
  for (const [i, line] of kept.entries()) {
    count.runs++;
    if (line.matchesHistory) count.matchingFailures++;
    else if (FAILED.has(line.status)) {
      count.otherFailures++;
      const signature = line.errorSignature ?? line.status;
      others.set(signature, (others.get(signature) ?? 0) + 1);
    }
    if (arm.stopAt != null && count.matchingFailures >= arm.stopAt) {
      count.stoppedEarly = i < kept.length - 1;
      break;
    }
  }
  count.otherSignatures = [...others.entries()].sort((a, b) => b[1] - a[1]).map(([s]) => s);
  return count;
}

/** Whether an arm is done: it reached its stop, or counted all its runs. */
export function armDone(count: ArmCount, arm: Pick<LabArm, 'runs' | 'stopAt'>): boolean {
  return (arm.stopAt != null && count.matchingFailures >= arm.stopAt) || count.runs >= arm.runs;
}

/**
 * How many runs the next Playwright invocation of an arm asks for: all the
 * runs left for an arm that never stops early, else at most
 * {@link FLAKE_BATCH_RUNS}. After a batch whose rounds were discarded, it asks
 * again for what is still missing.
 */
export function nextBatch(count: ArmCount, arm: Pick<LabArm, 'runs' | 'stopAt'>): number {
  const left = Math.max(0, arm.runs - count.runs);
  return arm.stopAt == null ? left : Math.min(left, FLAKE_BATCH_RUNS);
}

/** Escape a string for a regular expression. */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * The `--grep` that selects one test by its describe path and title: Playwright
 * matches it against the project, file, describe titles and title joined by
 * spaces, then the test's tags (`@slow`), so the title must follow a space and
 * end the name or come before the tags.
 */
export function grepFor(tests: FlakeTestRef[]): string {
  return tests.map((t) => `(^| )${escapeRegex([...t.suite, t.title].join(' '))}( @\\S+)*$`).join('|');
}

/**
 * The `playwright test` arguments of one batch of an arm: the spec files and a
 * grep selecting the target and any companion, the repeats, retries off, the
 * workers the condition needs (2 for `alongside`, with `--fully-parallel` when
 * both tests share a file; otherwise 1, so the attempts run one at a time as
 * in the control), and the project the plan pins or the arm's `project`
 * condition names.
 */
export function playwrightArgs(test: FlakePlanTest, arm: Pick<LabArm, 'conditions'>, repeat: number): string[] {
  const companion = workerCondition(arm.conditions);
  const tests: FlakeTestRef[] = companion ? [test, companion.test] : [test];
  const files = [...new Set(tests.map((t) => t.file))];
  const args = [...files, '--grep', grepFor(tests), `--repeat-each=${repeat}`, '--retries=0'];
  const alongside = companion?.kind === 'alongside';
  args.push(`--workers=${alongside ? 2 : 1}`);
  if (alongside && files.length === 1) args.push('--fully-parallel');
  const project = arm.conditions.find((c) => c.kind === 'project');
  const name = project?.kind === 'project' ? project.name : test.project;
  if (name) args.push(`--project=${name}`);
  return args;
}

/** One arm's verdict against the control, as the dashboard computes it. */
export interface ArmVerdict {
  verdict: FlakeVerdict;
  rate: number;
  pValue: number;
}

export function armVerdict(arm: ArmCount, control: ArmCount): ArmVerdict {
  return flakeArmVerdict(arm, control);
}

export type VerifyVerdict = 'verified' | 'still-fails' | 'inconclusive';

/** A verify arm's verdict for the rate the arm reproduced at. */
export function verifyVerdict(arm: ArmCount, reproducedRate: number): VerifyVerdict {
  if (arm.matchingFailures > 0) return 'still-fails';
  return flakeFixVerified(arm, reproducedRate) ? 'verified' : 'inconclusive';
}

export const EXIT_REPRODUCED = 0;
export const EXIT_NOT_REPRODUCED = 1;
export const EXIT_ERROR = 2;
/** A bisect step that cannot judge its commit: the code `git bisect run` skips on. */
export const EXIT_BISECT_SKIP = 125;

/** 0 when an arm reproduced (or the fix held), 1 otherwise. */
export function exitCodeFor(verdict: FlakeVerdict | VerifyVerdict | string): number {
  return verdict === 'reproduced' || verdict === 'verified' ? EXIT_REPRODUCED : EXIT_NOT_REPRODUCED;
}

/**
 * A bisect step's exit code from the verify arm's verdict: 0 (good) when the
 * fix holds at this commit, 1 (bad) on a matching failure, 125 (skip) with too
 * few clean runs to tell.
 */
export function bisectExitCode(verdict: VerifyVerdict | string): number {
  if (verdict === 'verified') return EXIT_REPRODUCED;
  if (verdict === 'still-fails') return EXIT_NOT_REPRODUCED;
  return EXIT_BISECT_SKIP;
}

/**
 * A duration from the command line: `15m`, `90s`, `1h`, `1h30m`, or a bare
 * number of minutes. Null when it cannot be read.
 */
export function parseDuration(text: string): number | null {
  const trimmed = text.trim().toLowerCase();
  if (/^\d+(\.\d+)?$/.test(trimmed)) return Math.round(Number(trimmed) * 60_000);
  const re = /(\d+(?:\.\d+)?)\s*(h|m|s)/g;
  let total = 0;
  let consumed = '';
  for (const m of trimmed.matchAll(re)) {
    total += Number(m[1]) * (m[2] === 'h' ? 3_600_000 : m[2] === 'm' ? 60_000 : 1000);
    consumed += m[0];
  }
  return consumed.replace(/\s/g, '') === trimmed.replace(/\s/g, '') && total > 0 ? Math.round(total) : null;
}

/** A duration for the terminal: `45 s`, `4 min`, `1 h 10 min`. */
export function formatDuration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * Whether the session may start another arm. The budget is checked only before
 * an arm starts, so an arm that started always finishes.
 */
export function withinBudget(startedAt: number, now: number, budgetMs: number): boolean {
  return now - startedAt < budgetMs;
}
