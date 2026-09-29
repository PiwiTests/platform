/**
 * The page each locator call ran on, as the capture fixtures record it
 * (`piwi-locator-pages`, the `locatorPages` field of a case): validated at
 * ingest, stored per execution through `case_payloads`, and joined to the
 * locator index by (call site, chain) — see `locator-usages.ts`.
 *
 * Only the page's origin and its key (`/orders/:id`) are kept; the key is
 * normalized again here, so a reporter cannot store a raw path. Shared by the
 * server ingest path and the demo mirror.
 */
import { canonicalLocator } from '#shared/locator-chain';
import { pageKey } from '@piwitests/core/page-key';
import type { LocatorPageUse } from '@piwitests/core/wire';

/** Entries kept per execution, as the reporter caps them. */
export const MAX_STORED_LOCATOR_PAGES = 1000;
/** Longest call site, chain, origin and page key kept; longer entries are dropped. */
const MAX_FIELD_CHARS = 1000;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 && value.length <= MAX_FIELD_CHARS ? value : null;

/** An http(s) origin, as `URL.origin` prints it; null for anything else. */
function originOf(value: unknown): string | null {
  const raw = text(value);
  if (!raw || !/^https?:\/\//i.test(raw)) return null;
  try {
    const origin = new URL(raw).origin;
    return origin === 'null' ? null : origin;
  } catch {
    return null;
  }
}

/**
 * The valid entries of a case's `locatorPages`, with canonical chains and
 * normalized page keys, deduped (an entry on arrival wins) and capped. Null
 * when nothing valid remains.
 */
export function sanitizeLocatorPages(raw: unknown): LocatorPageUse[] | null {
  if (!Array.isArray(raw)) return null;
  const out = new Map<string, LocatorPageUse>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const entry = item as Record<string, unknown>;
    const location = text(entry.location);
    const chain = text(entry.locator);
    const locator = chain ? canonicalLocator(chain) : null;
    const origin = originOf(entry.origin);
    const rawPage = text(entry.page);
    const page = rawPage ? pageKey(rawPage) : null;
    if (!location || !locator || locator.length > MAX_FIELD_CHARS || !origin || !page) continue;
    const arrival = entry.arrival === true;
    const key = `${location}\x00${locator}\x00${origin}\x00${page}`;
    const existing = out.get(key);
    if (existing) {
      existing.arrival ||= arrival;
      continue;
    }
    if (out.size >= MAX_STORED_LOCATOR_PAGES) break;
    out.set(key, { location, locator, origin, page, arrival });
  }
  return out.size > 0 ? [...out.values()] : null;
}

/** A stored payload read back: the entries, or null when it holds none or does not parse. */
export function parseStoredLocatorPages(content: string | null | undefined): LocatorPageUse[] | null {
  if (!content) return null;
  try {
    return sanitizeLocatorPages(JSON.parse(content));
  } catch {
    return null;
  }
}
