/**
 * A `Group by` preference persisted in a `piwi-group-by-<key>` cookie, read on
 * the server and the client so the first render matches the saved choice. Only
 * one of `valid` is ever stored; anything else reads back as `null` so the
 * caller can fall back to a data-derived default (e.g. cluster on a red run).
 */
export function useGroupByCookie(key: string, valid: readonly string[]) {
  const cookieKey = `piwi-group-by-${key}`;
  const raw = ref<string | null>(null);

  function read(cookieStr: string): void {
    const match = cookieStr.match(new RegExp(`(?:^|;\\s*)${cookieKey}=([^;]*)`));
    if (match && valid.includes(match[1] ?? '')) raw.value = match[1] ?? null;
  }

  if (import.meta.server) {
    try {
      read(useRequestHeaders(['cookie']).cookie || '');
    } catch {
      // headers not available
    }
  } else {
    try {
      read(document.cookie);
    } catch {
      // document not available
    }
  }

  function set(val: string): void {
    if (!valid.includes(val)) return;
    raw.value = val;
    if (import.meta.client) {
      document.cookie = `${cookieKey}=${val}; path=/; max-age=31536000; sameSite=lax`;
    }
  }

  return { raw, set };
}
