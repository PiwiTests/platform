import {
  RANK_MARKED_MESSAGE,
  RANK_SELECTED_GLOBAL,
  SELECTION_MARK,
  type SelectionRanking,
} from '../shared/devtools-selection.js';
import {
  evalInPage,
  hasContentScriptContext,
  injectContentScript,
  inspectedOrigin,
  inspectedTabId,
  sitePattern,
} from './inspected.js';

/** The content script that ranks DevTools' selection. */
export const RANK_SCRIPT = 'devtools-rank.js';

export type RankOutcome =
  | { kind: 'ranked'; ranking: SelectionRanking }
  /** The content script cannot be injected: the origin's host permission would allow it. */
  | { kind: 'no-access'; pattern: string }
  /** A page no extension runs on (`chrome://`, the store, a file without file access). */
  | { kind: 'restricted' }
  | { kind: 'failed'; message: string };

/** Asks the content script, if it is there, to rank `$0`; null when it is not injected. */
async function askRanking(): Promise<SelectionRanking | null> {
  if (hasContentScriptContext()) {
    const result = await evalInPage<SelectionRanking | null>(
      `typeof ${RANK_SELECTED_GLOBAL} === 'function' ? ${RANK_SELECTED_GLOBAL}($0) : null`,
      { contentScript: true },
    );
    return result.ok ? result.value : null;
  }
  const token = crypto.randomUUID();
  const marked = await evalInPage<boolean>(
    `(() => { const n = $0; const el = n && n.nodeType === 3 ? n.parentElement : n;
      if (!el || el.nodeType !== 1) return false; el.setAttribute('${SELECTION_MARK}', '${token}'); return true; })()`,
  );
  if (!marked.ok || !marked.value) return { status: 'none' };
  try {
    const answer = (await chrome.tabs.sendMessage(inspectedTabId(), { type: RANK_MARKED_MESSAGE, token })) as
      | SelectionRanking
      | undefined;
    return answer ?? null;
  } catch {
    return null;
  }
}

/**
 * The ranked locators of DevTools' selection. The content script is injected
 * the first time, and again after each navigation; when the extension has no
 * access to the page, the outcome says which permission would give it.
 */
export async function rankDevtoolsSelection(): Promise<RankOutcome> {
  const first = await askRanking();
  if (first) return { kind: 'ranked', ranking: first };
  const injected = await injectContentScript(RANK_SCRIPT);
  if (!injected.ok) {
    const pattern = sitePattern(await inspectedOrigin());
    return pattern ? { kind: 'no-access', pattern } : { kind: 'restricted' };
  }
  const second = await askRanking();
  return second ? { kind: 'ranked', ranking: second } : { kind: 'failed', message: '' };
}
