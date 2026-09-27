import { tryParseLocatorChain } from '@piwitests/core/locator-chain';
import { assessLocatorChain, type LocatorStabilityRuleId } from '@piwitests/core/locator-stability';
import {
  RANK_MARKED_MESSAGE,
  RANK_SELECTED_GLOBAL,
  SELECTION_MARK,
  type SelectionLocator,
  type SelectionRanking,
} from '../shared/devtools-selection.js';
import { checkLocators, isPiwiElement, rankElement, type CheckedLocator } from './verified-locators.js';

/**
 * Ranks the node selected in DevTools for the Elements sidebar, with the same
 * verified ranking the Pick tool shows. Injected into the inspected tab by the
 * sidebar; the sidebar calls {@link RANK_SELECTED_GLOBAL} with `$0` through
 * `chrome.devtools.inspectedWindow.eval(…, { useContentScriptContext: true })`,
 * or, where that option is missing, marks `$0` with {@link SELECTION_MARK} in
 * the page's world and asks by message.
 */

/** How many locators the sidebar lists. */
const MAX_LOCATORS = 6;

function toSelectionLocator(alt: CheckedLocator): SelectionLocator {
  const chain = tryParseLocatorChain(alt.locator);
  const stability = chain ? assessLocatorChain(chain) : null;
  const rules: LocatorStabilityRuleId[] = [];
  for (const finding of stability?.findings ?? []) if (!rules.includes(finding.rule)) rules.push(finding.rule);
  return {
    locator: alt.locator,
    verdict: alt.verdict,
    count: alt.count,
    fromCount: alt.from?.count ?? null,
    stability: stability?.level ?? 'watch',
    rules,
  };
}

export function rankSelected(node: unknown): SelectionRanking {
  const candidate = node as Node | null | undefined;
  const el = candidate?.nodeType === Node.TEXT_NODE ? candidate.parentElement : candidate;
  if (!el || el.nodeType !== Node.ELEMENT_NODE) return { status: 'none' };
  const element = el as Element;
  if (element.ownerDocument !== document) return { status: 'frame' };
  if (isPiwiElement(element)) return { status: 'extension' };
  const { ranked, accessibleName, role } = rankElement(element);
  const checked = checkLocators(element, ranked, { keepAmbiguous: true });
  return {
    status: 'ranked',
    pageUrl: location.href,
    tag: element.localName,
    role,
    name: accessibleName,
    locators: checked.slice(0, MAX_LOCATORS).map(toSelectionLocator),
  };
}

const g = globalThis as Record<string, unknown>;
if (typeof g[RANK_SELECTED_GLOBAL] !== 'function') {
  g[RANK_SELECTED_GLOBAL] = rankSelected;
  // Absent when a test runs the bundle in a page's own world.
  (globalThis as { chrome?: typeof chrome }).chrome?.runtime?.onMessage?.addListener(
    (message, _sender, sendResponse) => {
      if (message?.type !== RANK_MARKED_MESSAGE || typeof message.token !== 'string') return undefined;
      const marked = document.querySelector(`[${SELECTION_MARK}="${CSS.escape(message.token)}"]`);
      marked?.removeAttribute(SELECTION_MARK);
      sendResponse(rankSelected(marked));
      return undefined;
    },
  );
}
