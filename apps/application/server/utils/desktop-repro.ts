/**
 * Desktop build: the repro requests Piwi Picker and the editors sent, kept in
 * memory until the developer runs or declines them in the window (see
 * `shared/desktop-repro.ts`).
 *
 * A request waits `REPRO_REQUEST_TTL_MS` for the developer, then reads as
 * expired as long again; once answered, its verdict stays readable as long
 * again, for the extension or the editor polling it. A running request stays until its run
 * ends, however long it takes. Each open window listens on the desktop event
 * stream, which registers it here, and is told of every new request.
 */
import { randomBytes } from 'node:crypto';
import {
  REPRO_REQUEST_TTL_MS,
  type ReproRequestInput,
  type ReproRequestPatch,
  type ReproRequestView,
} from '#shared/desktop-repro';

/** Requests kept at once; the oldest goes first. */
const MAX_REQUESTS = 50;

interface StoredRepro extends ReproRequestView {
  /** When the request stops being readable. */
  until: number;
}

const requests = new Map<string, StoredRepro>();
type ReproListener = (request: ReproRequestView) => void;
const listeners = new Set<ReproListener>();

function view(stored: StoredRepro): ReproRequestView {
  const { until: _until, ...rest } = stored;
  return rest;
}

function sweep(now = Date.now()): void {
  for (const [id, stored] of requests) {
    if (stored.status === 'waiting' && Date.parse(stored.expiresAt) <= now) stored.status = 'expired';
    if (stored.status !== 'running' && stored.until <= now) requests.delete(id);
  }
}

/** Keep a new request and tell every listening window. */
export function createReproRequest(input: ReproRequestInput): ReproRequestView {
  sweep();
  while (requests.size >= MAX_REQUESTS) requests.delete(requests.keys().next().value!);
  const now = Date.now();
  const stored: StoredRepro = {
    id: randomBytes(8).toString('hex'),
    kind: input.kind,
    title: input.title,
    steps: input.kind === 'steps' ? input.steps : null,
    options: input.kind === 'steps' ? input.options : { headed: false, trace: false, repeatEach: 1 },
    job: input.kind === 'steps' ? null : input.job,
    bugReportId: input.kind === 'steps' ? input.bugReportId : null,
    instanceUrl: input.instanceUrl,
    status: 'waiting',
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + REPRO_REQUEST_TTL_MS).toISOString(),
    projectId: null,
    verdict: null,
    jobVerdict: null,
    runId: null,
    until: now + 2 * REPRO_REQUEST_TTL_MS,
  };
  requests.set(stored.id, stored);
  const shown = view(stored);
  for (const listener of listeners) listener(shown);
  return shown;
}

export function getReproRequest(id: string): ReproRequestView | null {
  sweep();
  const stored = requests.get(id);
  return stored ? view(stored) : null;
}

/** The requests still waiting for the developer, oldest first. */
export function waitingReproRequests(): ReproRequestView[] {
  sweep();
  return [...requests.values()].filter((r) => r.status === 'waiting').map(view);
}

/**
 * Record what the window did with a request: started it in a project,
 * declined it, or finished it with a verdict. Null when the request is gone,
 * or no longer in a state that step follows from.
 */
export function updateReproRequest(id: string, patch: ReproRequestPatch): ReproRequestView | null {
  sweep();
  const stored = requests.get(id);
  if (!stored) return null;
  const from = stored.status;
  const allowed =
    patch.status === 'running'
      ? from === 'waiting' || from === 'done'
      : patch.status === 'declined'
        ? from === 'waiting'
        : from === 'running';
  if (!allowed) return null;
  stored.status = patch.status;
  if (patch.projectId != null) stored.projectId = patch.projectId;
  if (patch.status === 'running') {
    stored.verdict = null;
    stored.jobVerdict = null;
  }
  if (patch.verdict !== undefined) stored.verdict = patch.verdict ?? null;
  if (patch.jobVerdict !== undefined) stored.jobVerdict = patch.jobVerdict ?? null;
  if (patch.runId != null) stored.runId = patch.runId;
  stored.until = Math.max(stored.until, Date.now() + REPRO_REQUEST_TTL_MS);
  return view(stored);
}

/** Receive every new request; returns the unsubscribe function. */
export function subscribeReproRequests(listener: ReproListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether any window is listening, so the sender can say the request is waiting for no one. */
export function reproListenerCount(): number {
  return listeners.size;
}
