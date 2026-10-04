/**
 * The first bad commit a bisect found, as a client records it on a failure
 * cluster (`POST /api/failure-clusters/:id/bisect`, MCP `set_cluster_bisect`):
 * the desktop app for a bisect it ran against its own instance, an editor
 * sharing a bisect the desktop app ran for a team instance's failure.
 */

/** The request body: a commit SHA, and what git said about it. */
export interface BisectResultBody {
  /** The commit's SHA, 7 to 40 hex characters. */
  sha: string;
  /** The commit's subject line. */
  subject?: string | null;
  author?: string | null;
  /** ISO date the commit was authored. */
  date?: string | null;
}

/** A body as stored: the SHA lower-cased, every other field trimmed, empty ones null. */
export interface BisectResult {
  sha: string;
  subject: string;
  author: string | null;
  date: string | null;
}

const SHA = /^[0-9a-f]{7,40}$/;
const MAX_TEXT = 500;

export type ParseBisectResult = { ok: true; value: BisectResult } | { ok: false; message: string };

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT) : null;
}

/** Read a {@link BisectResultBody} from untrusted input. */
export function parseBisectResultBody(body: unknown): ParseBisectResult {
  const input = body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const sha = typeof input.sha === 'string' ? input.sha.trim().toLowerCase() : '';
  if (!SHA.test(sha)) return { ok: false, message: 'A valid commit SHA is required' };
  return {
    ok: true,
    value: { sha, subject: text(input.subject) ?? '', author: text(input.author), date: text(input.date) },
  };
}
