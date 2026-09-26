import type { LocatorCall, ParsedLocatorChain } from '../shared/locator-expr.js';
import { domRoleOf, domHeadingLevel, type DomRoleMaps } from '@piwitests/picker-dom';
import { approximateAccessibleName, type ElementAttributes } from '@piwitests/core/locator-generation';

export interface LocatorEvalResult {
  elements: Element[];
  /**
   * False when any step in the chain relied on approximated matching rather
   * than exact attribute/role equality — text/label/placeholder/alt/title
   * content, `filter({hasText})`, or a `getByRole` name all go through
   * substring/accessible-name approximation rather than Playwright's real
   * accname computation (unreachable from a content script without the
   * `debugger` permission — see `extension/AGENTS.md`). Mirrors the same
   * exact/approximate distinction `live-count.ts` draws for ranked
   * candidates. Shown in the console as a caveat, never hidden.
   */
  exact: boolean;
}

/**
 * Match a parsed locator chain against the live DOM right now. Throws on an
 * invalid `locator()` CSS selector — callers should show `error.message`,
 * not a stack trace (mirrors `parseLocatorExpression`'s own contract).
 *
 * Every matching helper is nested here rather than a module-level sibling:
 * this function is re-serialized via `Function.prototype.toString()` in
 * tests (installing `domRoleOf`/`domHeadingLevel`/`approximateAccessibleName`
 * as globals first, same as `live-count.spec.ts`), which only ever carries a
 * function's own source text — a sibling top-level helper wouldn't come
 * along for the ride.
 */
export function evaluateLocatorChain(chain: ParsedLocatorChain, maps: DomRoleMaps): LocatorEvalResult {
  // Every tag with an entry in tagRoles, not just the handful with an
  // obvious role — a role like 'row' or 'listitem' lives on <tr>/<li>, which
  // getByRole() must still be able to find. Mirrors pick.ts's ROLE_SOURCES.
  const ROLE_CANDIDATES = [...new Set(['[role]', 'input', 'select', ...Object.keys(maps.tagRoles)])].join(',');
  const APPROXIMATE_METHODS = new Set([
    'getByText',
    'getByLabel',
    'getByPlaceholder',
    'getByAltText',
    'getByTitle',
    'filter',
  ]);

  function normalize(s: string): string {
    return s.replace(/\s+/g, ' ').trim();
  }

  function textMatches(candidate: string, expected: string, exact: boolean | undefined): boolean {
    const c = normalize(candidate);
    const e = normalize(expected);
    return exact ? c === e : c.toLowerCase().includes(e.toLowerCase());
  }

  /** `root`'s text, leaving out `skip`'s subtree — a wrapping label's text without the field it wraps. */
  function textWithout(root: Node, skip: Node): string {
    if (root === skip) return '';
    if (root.nodeType === 3) return root.nodeValue || '';
    let text = '';
    for (const child of root.childNodes) text += textWithout(child, skip);
    return text;
  }

  /** The text of the elements `aria-labelledby` points at, else of the first `<label>` — mirrors the probe's `labelText`. */
  function fieldLabelOf(el: Element): string | null {
    let text = '';
    for (const id of (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)) {
      const ref = el.ownerDocument.getElementById(id);
      if (ref) text += ` ${textWithout(ref, el)}`;
    }
    const label = (el as HTMLInputElement).labels?.[0];
    if (!text.trim() && label) text = textWithout(label, el);
    return normalize(text).slice(0, 120) || null;
  }

  function accessibleNameOf(el: Element): string {
    const attrs: ElementAttributes = {
      tagName: el.tagName.toLowerCase(),
      attributes: {
        'aria-labelledby': el.getAttribute('aria-labelledby'),
        'aria-label': el.getAttribute('aria-label'),
        title: el.getAttribute('title'),
        placeholder: el.getAttribute('placeholder'),
      },
      textContent: normalize(el.textContent || '').slice(0, 80),
      labelText: fieldLabelOf(el),
      accessibleName: null,
      center: null,
    };
    return approximateAccessibleName(attrs) ?? '';
  }

  function labelTextOf(el: Element): string {
    const label = (el as HTMLInputElement).labels?.[0];
    return label?.textContent ? normalize(label.textContent) : (el.getAttribute('aria-label') ?? '');
  }

  function matchLeaf(call: LocatorCall): Element[] {
    switch (call.method) {
      case 'getByTestId':
        return [...document.querySelectorAll(`[data-testid=${JSON.stringify(call.text)}]`)];

      case 'locator':
        try {
          return [...document.querySelectorAll(call.selector)];
        } catch {
          throw new Error(`"${call.selector}" isn't a valid CSS selector`);
        }

      case 'getByRole': {
        const out: Element[] = [];
        for (const el of document.querySelectorAll(ROLE_CANDIDATES)) {
          if (domRoleOf(el, maps) !== call.role) continue;
          if (call.level != null && domHeadingLevel(el) !== call.level) continue;
          if (call.name != null && !textMatches(accessibleNameOf(el), call.name, call.exact)) continue;
          out.push(el);
        }
        return out;
      }

      case 'getByText':
        return [...document.querySelectorAll('body *')].filter(
          (el) => el.children.length === 0 && textMatches(el.textContent || '', call.text, call.exact),
        );

      case 'getByLabel':
        return [...document.querySelectorAll('input,select,textarea')].filter((el) =>
          textMatches(labelTextOf(el), call.text, call.exact),
        );

      case 'getByPlaceholder':
        return [...document.querySelectorAll('[placeholder]')].filter((el) =>
          textMatches(el.getAttribute('placeholder') || '', call.text, call.exact),
        );

      case 'getByAltText':
        return [...document.querySelectorAll('[alt]')].filter((el) =>
          textMatches(el.getAttribute('alt') || '', call.text, call.exact),
        );

      case 'getByTitle':
        return [...document.querySelectorAll('[title]')].filter((el) =>
          textMatches(el.getAttribute('title') || '', call.text, call.exact),
        );

      default:
        throw new Error(`${call.method}() can't start a chain`);
    }
  }

  function applyNarrowing(call: LocatorCall, candidates: Element[]): Element[] {
    switch (call.method) {
      case 'filter': {
        let out = candidates;
        if (call.hasText != null) {
          const needle = call.hasText.toLowerCase();
          out = out.filter((el) =>
            normalize(el.textContent || '')
              .toLowerCase()
              .includes(needle),
          );
        }
        if (call.hasNotText != null) {
          const needle = call.hasNotText.toLowerCase();
          out = out.filter(
            (el) =>
              !normalize(el.textContent || '')
                .toLowerCase()
                .includes(needle),
          );
        }
        return out;
      }
      case 'first':
        return candidates.slice(0, 1);
      case 'last':
        return candidates.length > 0 ? [candidates[candidates.length - 1]!] : [];
      case 'nth':
        return candidates[call.index] != null ? [candidates[call.index]!] : [];
      default:
        throw new Error(`${call.method}() can't narrow a chain`);
    }
  }

  const [leaf, ...rest] = chain.calls;
  if (!leaf) return { elements: [], exact: true };

  let exact = !(leaf.method === 'getByRole' && leaf.name != null) && !APPROXIMATE_METHODS.has(leaf.method);
  let candidates = matchLeaf(leaf);
  for (const call of rest) {
    candidates = applyNarrowing(call, candidates);
    if (APPROXIMATE_METHODS.has(call.method)) exact = false;
  }
  return { elements: candidates, exact };
}
