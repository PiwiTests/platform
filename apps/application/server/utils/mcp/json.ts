/**
 * Shaping helpers for MCP tool results, which are JSON read by an agent: every
 * byte is a token, so empty fields are left out rather than sent as `null`.
 */

/** Drop `null`, `undefined`, `''` and `[]` fields from an object. */
export function dropNulls<T extends object>(obj: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(obj).filter(([, v]) => {
      if (v == null || v === '') return false;
      if (Array.isArray(v) && v.length === 0) return false;
      return true;
    }),
  ) as Partial<T>;
}
