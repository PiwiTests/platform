import { t } from './i18n.js';

/**
 * `chrome.storage.session` from any context, including a content script in
 * Firefox.
 *
 * Chrome lets content scripts use session storage once the background worker
 * has widened its access level (`setAccessLevel`, see `background/index.ts`
 * and `session-access.ts`). Firefox has no `setAccessLevel` and leaves
 * `storage.session` out of content scripts altogether, so there each call is
 * sent to the background script as a `piwi-session-storage` message and
 * {@link serveSessionStorage} runs it against the real area. Extension pages
 * and the background script have the area in both browsers and use it
 * directly.
 *
 * Every module that keeps state in session storage goes through
 * {@link sessionArea} rather than `chrome.storage.session`, since the same
 * module is imported by content scripts, the popup and the background.
 */
export interface SessionArea {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

type SessionStorageRequest =
  | { type: 'piwi-session-storage'; op: 'get'; key: string }
  | { type: 'piwi-session-storage'; op: 'set'; items: Record<string, unknown> }
  | { type: 'piwi-session-storage'; op: 'remove'; key: string };

export type SessionStorageResponse = { ok: true; items?: Record<string, unknown> } | { ok: false; error: string };

const direct: SessionArea = {
  get: (key) => chrome.storage.session.get(key),
  set: (items) => chrome.storage.session.set(items),
  remove: (key) => chrome.storage.session.remove(key),
};

async function viaBackground(request: SessionStorageRequest): Promise<Record<string, unknown>> {
  const response = (await chrome.runtime.sendMessage(request)) as SessionStorageResponse | undefined;
  // Rejects like the real area does on a failed write (a full quota, say), so a
  // caller sees the failure rather than a write that silently never happened.
  if (!response?.ok) throw new Error(response?.error ?? t('common_workerNoAnswer'));
  return response.items ?? {};
}

const viaBackgroundArea: SessionArea = {
  get: (key) => viaBackground({ type: 'piwi-session-storage', op: 'get', key }),
  set: async (items) => {
    await viaBackground({ type: 'piwi-session-storage', op: 'set', items });
  },
  remove: async (key) => {
    await viaBackground({ type: 'piwi-session-storage', op: 'remove', key });
  },
};

/** False in a content script in Firefox, the one context without session storage. */
export function hasSessionArea(): boolean {
  return Boolean(chrome.storage?.session);
}

/** The real session area where this context has it, else the background script's. */
export function sessionArea(): SessionArea {
  return hasSessionArea() ? direct : viaBackgroundArea;
}

/**
 * The background script's half: runs one `piwi-session-storage` request
 * against the real area. It grants content scripts exactly what
 * `setAccessLevel` grants them in Chrome; page scripts cannot send extension
 * messages, so it is not reachable from a page.
 */
export async function serveSessionStorage(
  request: { op?: unknown; key?: unknown; items?: unknown },
  area: SessionArea = direct,
): Promise<SessionStorageResponse> {
  try {
    if (request.op === 'get' && typeof request.key === 'string')
      return { ok: true, items: await area.get(request.key) };
    if (request.op === 'remove' && typeof request.key === 'string') {
      await area.remove(request.key);
      return { ok: true };
    }
    if (request.op === 'set' && request.items && typeof request.items === 'object') {
      await area.set(request.items as Record<string, unknown>);
      return { ok: true };
    }
    return { ok: false, error: 'Malformed session-storage request.' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}
