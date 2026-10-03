/**
 * Desktop shell: what an editor's job (reproduce or bisect a failure from the
 * instance the editor reads) ended with, and the origin reference each local
 * run is stamped with so the window finds the run the reporter recorded.
 */
import type { DesktopJobVerdict } from '@piwitests/core/desktop-job';
import type { RunOriginKind } from '@piwitests/core/wire';

/** The fields of a local run a job's verdict reads. */
export interface JobRunOutcome {
  kind: 'tests' | 'reproduce' | 'bisect' | 'repro' | 'flake';
  status: 'running' | 'passed' | 'failed' | 'stopped' | 'error';
  /** The phase the run was in when it ended: `test` once the failing tests ran. */
  phase: string | null;
  bisect: { firstBad: { sha: string; subject: string; author: string | null; date: string | null } | null } | null;
  lines: Array<{ text: string; error: boolean }>;
}

function lastError(run: JobRunOutcome, fallback: string): string {
  return (run.lines.findLast((l) => l.error)?.text ?? fallback).slice(0, 500);
}

/**
 * A finished job run's verdict: a bisect names its first bad commit or says
 * why it could not; a reproduction reproduced when the failing tests failed
 * again, did not when they passed, and is an error when it ended before they ran.
 */
export function desktopJobVerdict(run: JobRunOutcome): DesktopJobVerdict {
  if (run.status === 'stopped') return { kind: 'stopped' };
  if (run.kind === 'bisect') {
    const found = run.bisect?.firstBad;
    return found
      ? { kind: 'first-bad', commit: { ...found } }
      : { kind: 'error', reason: lastError(run, 'The bisect did not name a commit.') };
  }
  if (run.status === 'error' || run.phase !== 'test') {
    return { kind: 'error', reason: lastError(run, 'The run ended before the tests ran.') };
  }
  return run.status === 'passed' ? { kind: 'not-reproduced' } : { kind: 'reproduced' };
}

/** The origin the reporter records for a local run of this kind; null for a Flake Lab session's lab runs. */
export function localRunOriginKind(kind: JobRunOutcome['kind']): RunOriginKind | null {
  if (kind === 'tests') return 'desktop';
  if (kind === 'reproduce' || kind === 'repro') return 'reproduce';
  if (kind === 'bisect') return 'bisect';
  return null;
}

/** A reference for a local run nothing else names: unique, in the characters a reference allows. */
export function newLocalRunRef(prefix: string): string {
  return `${prefix}:${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
