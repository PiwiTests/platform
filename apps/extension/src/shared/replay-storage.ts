import type { PiwiSteps } from '@piwitests/core/steps';
import { sessionArea } from './session-area.js';
import type { RequestCondition } from './request-conditions.js';

/**
 * A running replay, in session storage so it survives the navigations it
 * causes: every page of the origin loads the replay script again, and it picks
 * up at `position`.
 */
export const REPLAY_KEY = 'piwiReplay';

export type ReplayStepStatus = 'done' | 'passed' | 'failed' | 'diverged';

export interface ReplayStepResult {
  status: ReplayStepStatus;
  /** Why a step diverged, or what an assertion found. */
  detail: string | null;
  /** What the page showed for an assertion that did not hold. */
  found?: string | null;
}

export type ReplayStatus = 'running' | 'paused' | 'done' | 'stopped';

export interface ReplayState {
  id: string;
  steps: PiwiSteps;
  /** The origin the steps replay on, such as `http://localhost:3000`. */
  origin: string;
  position: number;
  results: ReplayStepResult[];
  status: ReplayStatus;
  /** Wait for Next before each step. */
  stepMode: boolean;
  /** Where the fake cursor was, in viewport pixels, so the next page starts it there. */
  cursor: { x: number; y: number } | null;
  startedAt: number;
  /**
   * Set when the replay starts on the tab's page instead of opening the first
   * recorded one, whose address may differ (another id, other parameters).
   * Steps recorded on that page play on this one, whatever its address.
   */
  startPage?: { recorded: string; actual: string } | null;
  /** The request conditions on in the tab when the replay started (Slow down or fail a request). */
  conditions?: RequestCondition[];
}

function isReplayState(value: unknown): value is ReplayState {
  const v = value as Partial<ReplayState> | null;
  return !!v && typeof v.origin === 'string' && typeof v.position === 'number' && Array.isArray(v.results) && !!v.steps;
}

export async function getReplayState(): Promise<ReplayState | null> {
  const stored = await sessionArea().get(REPLAY_KEY);
  const value = stored[REPLAY_KEY];
  return isReplayState(value) ? value : null;
}

export async function setReplayState(state: ReplayState): Promise<void> {
  await sessionArea().set({ [REPLAY_KEY]: state });
}

export async function updateReplayState(change: (state: ReplayState) => ReplayState): Promise<ReplayState | null> {
  const state = await getReplayState();
  if (!state) return null;
  const next = change(state);
  await setReplayState(next);
  return next;
}

export async function clearReplayState(): Promise<void> {
  await sessionArea().remove(REPLAY_KEY);
}

/** A new replay of `steps` on `origin`, from its first step. */
export function newReplayState(
  steps: PiwiSteps,
  origin: string,
  stepMode: boolean,
  now = Date.now(),
  startPage: ReplayState['startPage'] = null,
): ReplayState {
  return {
    id: `${now.toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    steps,
    origin,
    position: 0,
    results: [],
    status: 'running',
    stepMode,
    cursor: null,
    startedAt: now,
    startPage,
  };
}
