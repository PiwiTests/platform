import {
  DEVTOOLS_GLOBAL,
  HIGHLIGHT_MESSAGE,
  MARK_MATCH_MESSAGE,
  QUERY_MESSAGE,
  REVEAL_MARK,
} from '../shared/devtools-selection.js';
import {
  evalInPage,
  hasContentScriptContext,
  injectContentScript,
  inspectedOrigin,
  inspectedTabId,
  sitePattern,
} from './inspected.js';
import { RANK_SCRIPT } from './selection.js';

/**
 * Calls into the DevTools content script (`devtools-rank.js`) from a DevTools
 * page: through `inspectedWindow.eval` in the extension's isolated world, or
 * by message where `useContentScriptContext` is missing. Injects it the first
 * time, and after each navigation.
 */

export type PageCall<T> =
  | { ok: true; value: T }
  /** The script cannot be injected; the origin's host permission would allow it. */
  | { ok: false; reason: 'no-access'; pattern: string }
  | { ok: false; reason: 'restricted' };

const MESSAGES = { query: QUERY_MESSAGE, highlight: HIGHLIGHT_MESSAGE, mark: MARK_MATCH_MESSAGE } as const;
type Method = keyof typeof MESSAGES;

async function attempt<T>(method: Method, arg: unknown): Promise<T | undefined> {
  if (hasContentScriptContext()) {
    const result = await evalInPage<T | null>(
      `typeof ${DEVTOOLS_GLOBAL} === 'object' ? ${DEVTOOLS_GLOBAL}.${method}(${JSON.stringify(arg)}) : null`,
      { contentScript: true },
    );
    return result.ok && result.value !== null ? result.value : undefined;
  }
  const field = method === 'query' ? 'expression' : 'index';
  try {
    return (await chrome.tabs.sendMessage(inspectedTabId(), { type: MESSAGES[method], [field]: arg })) as T;
  } catch {
    return undefined;
  }
}

export async function callPageScript<T>(method: Method, arg: unknown): Promise<PageCall<T>> {
  const first = await attempt<T>(method, arg);
  if (first !== undefined) return { ok: true, value: first };
  const injected = await injectContentScript(RANK_SCRIPT);
  if (!injected.ok) {
    const pattern = sitePattern(await inspectedOrigin());
    return pattern ? { ok: false, reason: 'no-access', pattern } : { ok: false, reason: 'restricted' };
  }
  const second = await attempt<T>(method, arg);
  return second !== undefined ? { ok: true, value: second } : { ok: false, reason: 'restricted' };
}

/** Selects match `index` of the last query in the Elements panel. */
export async function revealMatch(index: number): Promise<boolean> {
  const marked = await callPageScript<boolean>('mark', index);
  if (!marked.ok || !marked.value) return false;
  const revealed = await evalInPage<boolean>(
    `(() => { const el = document.querySelector('[${REVEAL_MARK}]'); if (!el) return false; el.removeAttribute('${REVEAL_MARK}'); inspect(el); return true; })()`,
  );
  return revealed.ok && revealed.value === true;
}
