/**
 * Send to editor: the editor Piwi Picker is paired with (VS Code or a JetBrains
 * IDE on this computer), kept in extension storage with its token. The
 * request a content script makes to send to it is in `editor-send.ts`.
 */
import type { EditorPairing } from '@piwitests/core/editor-send';

const PAIRING_KEY = 'piwiEditorPairing';

export async function getEditorPairing(): Promise<EditorPairing | null> {
  const stored = (await chrome.storage.local.get(PAIRING_KEY))[PAIRING_KEY] as Partial<EditorPairing> | undefined;
  return stored && typeof stored.url === 'string' && typeof stored.token === 'string'
    ? { url: stored.url, token: stored.token }
    : null;
}

export async function setEditorPairing(pairing: EditorPairing | null): Promise<void> {
  if (pairing) await chrome.storage.local.set({ [PAIRING_KEY]: pairing });
  else await chrome.storage.local.remove(PAIRING_KEY);
}

/** The host permission pattern for an editor's endpoint: its origin only. */
export function editorOriginPattern(pairing: EditorPairing): string {
  return `${new URL(pairing.url).origin}/*`;
}
