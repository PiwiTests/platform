/**
 * Client-probe fault application (Piwi Test Map). A probe run replays a passing
 * test and mutates one response at the Playwright route boundary; these pure
 * functions compute the mutated response from the real one, so the interception
 * layer stays a thin wrapper and the transformations are unit-tested.
 */

/** The faults a client probe applies at `page.route`. */
export const PROBE_FAULTS = ['status-500', 'empty-body', 'drop-field', 'stale-value', 'slow'] as const;
export type ProbeFault = (typeof PROBE_FAULTS)[number];

/** How long a `slow` fault delays a response, in milliseconds. */
export const SLOW_FAULT_DELAY_MS = 5000;

export interface FaultInput {
  /** The real response status. */
  status: number;
  /** The real response body as text. */
  body: string;
  contentType?: string | null;
  /** A previous response body for `stale-value` (replay); falls back to the current body. */
  priorBody?: string | null;
}

export interface FaultOutput {
  status: number;
  body: string;
  contentType?: string | null;
  /** Milliseconds to delay before responding; 0 for an immediate mutation. */
  delayMs: number;
}

/** Drop the first own key of a JSON object, or of each element of a JSON array. */
function dropOneField(body: string): string {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return body; // not JSON — nothing to drop
  }
  if (Array.isArray(parsed)) {
    let key: string | undefined;
    for (const el of parsed) {
      if (el && typeof el === 'object' && !Array.isArray(el)) {
        key ??= Object.keys(el as Record<string, unknown>)[0];
        if (key) delete (el as Record<string, unknown>)[key];
      }
    }
    return JSON.stringify(parsed);
  }
  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const key = Object.keys(obj)[0];
    if (key) delete obj[key];
    return JSON.stringify(obj);
  }
  return body;
}

/**
 * Compute the mutated response for a fault. `status-500` forces a 500;
 * `empty-body` blanks the body; `drop-field` removes one JSON key; `stale-value`
 * replays a previous body; `slow` delays the real response unchanged.
 */
export function computeFault(fault: ProbeFault, input: FaultInput): FaultOutput {
  const base: FaultOutput = {
    status: input.status,
    body: input.body,
    contentType: input.contentType ?? null,
    delayMs: 0,
  };
  switch (fault) {
    case 'status-500':
      return { ...base, status: 500 };
    case 'empty-body':
      return { ...base, body: '' };
    case 'drop-field':
      return { ...base, body: dropOneField(input.body) };
    case 'stale-value':
      return { ...base, body: input.priorBody ?? input.body };
    case 'slow':
      return { ...base, delayMs: SLOW_FAULT_DELAY_MS };
    default:
      return base;
  }
}
