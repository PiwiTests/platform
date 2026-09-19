/**
 * Pure helpers for the page inventory the capture fixtures attach on passing
 * runs. The in-page read (`readPageInventory` in `capture-fixtures.ts`) produces
 * the raw shape; these functions cap it and key it for the per-worker dedupe,
 * kept here so they can be unit-tested without a browser.
 */

/** One visited page's controls and links, names only. */
export interface RawPageInventory {
  url: string;
  controls: Array<{ role: string; name: string }>;
  links: Array<{ name: string; href: string }>;
  /** When this page settled (Unix ms), so a request can be attributed to the page current at its start. */
  capturedAt?: number;
}

/** Total control + link entries kept per page before templating (size rule 3). */
export const PAGE_INVENTORY_MAX_ENTRIES = 500;

/**
 * Cap a page's inventory at `max` total entries (controls first, then links),
 * so a table of hundreds of rows cannot blow up the payload. Returns a new
 * object; the input is not mutated.
 */
export function capPageInventory(inventory: RawPageInventory, max = PAGE_INVENTORY_MAX_ENTRIES): RawPageInventory {
  const controls = inventory.controls.slice(0, Math.max(0, max));
  const links = inventory.links.slice(0, Math.max(0, max - controls.length));
  return { url: inventory.url, controls, links, capturedAt: inventory.capturedAt };
}

/**
 * The per-worker dedupe key for a page: origin + pathname, with query and hash
 * dropped, so a URL visited by many tests is inventoried once. Returns null when
 * the URL cannot be parsed.
 */
export function inventoryPageKey(url: string): string | null {
  try {
    const u = new URL(url);
    return `${u.origin}${u.pathname}`;
  } catch {
    return null;
  }
}
