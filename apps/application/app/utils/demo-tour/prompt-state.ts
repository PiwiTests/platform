import { isTourLanguage, type TourLanguage } from './languages';

/** The `localStorage` key holding what a browser decided about the tour's prompt. */
export const TOUR_PROMPT_STORAGE_KEY = 'piwi-demo-tour';

/** How long **Later** keeps the prompt from opening by itself. */
export const TOUR_SNOOZE_MS = 24 * 60 * 60 * 1000;

/** **Later**, **×**, or a role picked (a tour started). */
export type TourPromptDecision = 'snoozed' | 'dismissed' | 'started';

const DECISIONS: readonly TourPromptDecision[] = ['snoozed', 'dismissed', 'started'];

/** What a browser remembers about the tour, stored as JSON under `TOUR_PROMPT_STORAGE_KEY`. */
export interface TourPromptState {
  decision?: TourPromptDecision;
  /** When the decision was made, in milliseconds since the epoch. */
  decidedAt?: number;
  /** The tour language picked in the prompt. */
  language?: TourLanguage;
}

/** The stored state from its raw `localStorage` value; anything missing or malformed is left out. */
export function readTourPromptState(raw: string | null): TourPromptState {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw ?? '');
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return {};
  const { decision, decidedAt, language } = parsed as Record<string, unknown>;
  const state: TourPromptState = {};
  if (DECISIONS.includes(decision as TourPromptDecision)) state.decision = decision as TourPromptDecision;
  if (typeof decidedAt === 'number' && Number.isFinite(decidedAt)) state.decidedAt = decidedAt;
  if (isTourLanguage(language)) state.language = language;
  return state;
}

/**
 * Whether the prompt opens by itself at `now`: on a browser that never decided,
 * or that picked **Later** at least `TOUR_SNOOZE_MS` ago (or at a time it no
 * longer knows). **×** and a started tour keep it closed.
 */
export function shouldAutoPrompt(state: TourPromptState, now: number): boolean {
  if (!state.decision) return true;
  if (state.decision !== 'snoozed') return false;
  return state.decidedAt === undefined || now - state.decidedAt >= TOUR_SNOOZE_MS;
}
