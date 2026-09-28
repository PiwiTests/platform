/**
 * A path to land on after signing in: same-origin only (`/…`, never `//host`
 * or a backslash a browser reads as one), at most 500 characters. Null otherwise.
 *
 * A browser drops tabs and line breaks from a URL before reading it, so
 * `/\t/evil.test` would leave as `//evil.test`: no control character passes.
 */
export function safeReturnPath(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 500) return null;
  if (!value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return null;
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code < 0x20 || code === 0x7f) return null;
  }
  return value;
}
