/**
 * Git ref safety for SCM provider URLs. A ref (`?base`, `?head`, `?sha`, a branch
 * name) is interpolated into a provider API path, so an unvalidated `..` segment
 * lets WHATWG URL resolution climb out of the repository path and reach another
 * repository the project's token can read — a path-traversal read across repos.
 *
 * Two layers, applied together: {@link isValidGitRef} rejects anything that is not
 * a plausible SHA or ref at every entry point, and {@link encodeGitRef} /
 * {@link encodePathSegments} percent-encode each path segment inside every
 * provider so a surviving special character can never change the request path.
 */

/** The longest ref we will accept — well past any real branch, tag or SHA. */
const MAX_REF_LENGTH = 256;

/**
 * A string is a safe git ref when it is a plausible SHA, branch, tag or path ref:
 * printable ASCII from a narrow set, with no traversal (`..`), no leading `-`
 * (option injection) or `/`, no trailing `/`, and no component starting with a
 * dot. Rejects the empty string, over-long input, whitespace and every character
 * git itself forbids in a ref, so `../../../other/repo` never reaches a provider.
 */
export function isValidGitRef(ref: unknown): ref is string {
  if (typeof ref !== 'string') return false;
  const r = ref.trim();
  if (r.length === 0 || r.length > MAX_REF_LENGTH) return false;
  if (r.includes('..')) return false; // traversal and git's `..` range operator
  if (!/^[A-Za-z0-9._/-]+$/.test(r)) return false; // narrow, URL-safe charset only
  if (r.startsWith('/') || r.endsWith('/')) return false;
  if (r.startsWith('-')) return false; // never let a ref look like a CLI option
  // No path component may start with a dot (blocks `.` / `./` segments too).
  if (r.split('/').some((seg) => seg.length === 0 || seg.startsWith('.'))) return false;
  return true;
}

/**
 * Percent-encode a ref for interpolation into a URL path, one `/`-separated
 * segment at a time so a slashed branch name (`release/1.2`) keeps its slashes
 * while every other special character is escaped. Pair with {@link isValidGitRef}
 * at the boundary — encoding is defense in depth, not a substitute for rejecting
 * a `..` traversal.
 */
export function encodeGitRef(ref: string): string {
  return ref.split('/').map(encodeURIComponent).join('/');
}

/** Percent-encode a file path for a URL, preserving its `/` separators. */
export function encodePathSegments(path: string): string {
  return path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}
