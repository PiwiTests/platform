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
 * Read the interactive controls (role + accessible name) and links (name + href)
 * on the current document. **Serialized and run in the page** by
 * `readPageInventory`, so it must stay self-contained — every helper is inline,
 * and it reads only `globalThis`. Exported so it can be unit-tested against a
 * fake DOM without a browser.
 *
 * Field **values are never read**: the accessible name of a control that holds
 * user input — a textbox, combobox, listbox, searchbox, spinbutton, `select`,
 * `textarea`, or contenteditable element — never falls back to `textContent`, so
 * a recovery code typed into a field, the text in a rich editor, or the options
 * of a `select` never leave the browser. Link hrefs are stripped of their query
 * and hash, which can carry signed tokens.
 */
export function collectPageInventoryInPage(maxEntries: number): RawPageInventory | null {
  const g = globalThis as any;
  const doc = g.document;
  if (!doc || !g.location) return null;
  const clean = (s: string | null | undefined): string => (s || '').replace(/\s+/g, ' ').trim().slice(0, 120);

  const roleOf = (el: any): string => {
    const explicit = el.getAttribute('role');
    if (explicit) return explicit.toLowerCase();
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'a') return el.getAttribute('href') != null ? 'link' : 'generic';
    if (tag === 'button') return 'button';
    if (tag === 'select') return el.hasAttribute('multiple') ? 'listbox' : 'combobox';
    if (tag === 'textarea') return 'textbox';
    if (tag === 'input') {
      const type = (el.getAttribute('type') || 'text').toLowerCase();
      const map: Record<string, string> = {
        checkbox: 'checkbox',
        radio: 'radio',
        button: 'button',
        submit: 'button',
        reset: 'button',
        image: 'button',
        range: 'slider',
        search: 'searchbox',
        email: 'textbox',
        tel: 'textbox',
        url: 'textbox',
        number: 'spinbutton',
      };
      return map[type] || 'textbox';
    }
    return 'generic';
  };

  // A value-bearing control's `textContent` is (or reflects) what the user typed
  // or selected, so it is never read for the accessible name.
  const holdsValue = (el: any, role: string): boolean => {
    const tag = (el.tagName || '').toLowerCase();
    if (tag === 'select' || tag === 'textarea' || tag === 'input') return true;
    if (el.isContentEditable === true) return true;
    const editable = el.getAttribute('contenteditable');
    if (editable === '' || editable === 'true') return true;
    return (
      role === 'textbox' || role === 'combobox' || role === 'listbox' || role === 'searchbox' || role === 'spinbutton'
    );
  };

  const labelText = (el: any): string => {
    const labels = el.labels;
    if (!labels || labels.length === 0) return '';
    let text = '';
    for (const label of labels) text += ` ${label.textContent || ''}`;
    return text;
  };

  const labelledByText = (el: any): string => {
    const ids = (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean);
    if (ids.length === 0) return '';
    let text = '';
    for (const id of ids) {
      const ref = doc.getElementById(id);
      if (ref) text += ` ${ref.textContent || ''}`;
    }
    return text;
  };

  const nameOf = (el: any): string => {
    const role = roleOf(el);
    const chain: Array<string | null> = [el.getAttribute('aria-label'), labelledByText(el), labelText(el)];
    if (!holdsValue(el, role)) chain.push(el.textContent);
    chain.push(el.getAttribute('placeholder'), el.getAttribute('title'), el.getAttribute('alt'));
    return clean(chain.find((s) => s && String(s).trim()) || '');
  };

  // Drop the query and fragment: either can carry a signed token or session id.
  const cleanHref = (href: string): string => {
    const cut = href.search(/[?#]/);
    return cut >= 0 ? href.slice(0, cut) : href;
  };

  const controls: Array<{ role: string; name: string }> = [];
  const links: Array<{ name: string; href: string }> = [];
  const seenC = new Set<string>();
  const seenL = new Set<string>();
  let budget = maxEntries;

  const controlSelector =
    'button, [role="button"], input, select, textarea, [role="checkbox"], [role="radio"], [role="tab"], [role="menuitem"], [role="combobox"], [role="switch"], [role="slider"], [role="searchbox"], [role="spinbutton"], [role="textbox"], [role="listbox"]';
  for (const el of Array.from(doc.querySelectorAll(controlSelector)) as any[]) {
    if (budget <= 0) break;
    const role = roleOf(el);
    const name = nameOf(el);
    if (!name) continue;
    const key = `${role}\u0000${name}`;
    if (seenC.has(key)) continue;
    seenC.add(key);
    controls.push({ role, name });
    budget--;
  }
  for (const el of Array.from(doc.querySelectorAll('a[href]')) as any[]) {
    if (budget <= 0) break;
    const name = nameOf(el);
    const href = cleanHref(el.getAttribute('href') || '');
    if (!name) continue;
    const key = `${name}\u0000${href}`;
    if (seenL.has(key)) continue;
    seenL.add(key);
    links.push({ name, href });
    budget--;
  }

  return { url: g.location.href, controls, links };
}

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
