/**
 * Send to editor: the editor Piwi Picker is paired with (VS Code or a JetBrains
 * IDE on this computer). Its address and token are kept together in the secret
 * area (`secret-store.ts`), which only the background worker and the options
 * page read; `chrome.storage.local` keeps the address alone, so a content
 * script knows an editor is paired. The request a content script makes to send
 * to it is in `editor-send.ts`.
 */
import type { EditorPairing } from '@piwitests/core/editor-send';
import { isExtensionContext, moveLegacySecret, secretArea, type SecretArea } from './secret-store.js';

const PAIRING_KEY = 'piwiEditorPairing';

function coercePairing(value: unknown): EditorPairing | null {
  const v = value as Partial<EditorPairing> | null | undefined;
  return v && typeof v.url === 'string' && typeof v.token === 'string' && v.token
    ? { url: v.url, token: v.token }
    : null;
}

/**
 * The paired editor. In the background worker and the options page it carries
 * the token; a content script, which cannot read it, gets the address with an
 * empty token, enough to know that an editor is paired.
 */
export async function getEditorPairing(area?: SecretArea): Promise<EditorPairing | null> {
  if (!area && !isExtensionContext()) {
    const stored = (await chrome.storage.local.get(PAIRING_KEY))[PAIRING_KEY] as { url?: unknown } | undefined;
    return stored && typeof stored.url === 'string' ? { url: stored.url, token: '' } : null;
  }
  const secrets = area ?? secretArea();
  await moveLegacyEditorPairing(secrets);
  return coercePairing(await secrets.get('editor'));
}

export async function setEditorPairing(pairing: EditorPairing | null, area: SecretArea = secretArea()): Promise<void> {
  if (pairing) {
    await area.set('editor', { url: pairing.url, token: pairing.token });
    await chrome.storage.local.set({ [PAIRING_KEY]: { url: pairing.url } });
  } else {
    await area.remove('editor');
    await chrome.storage.local.remove(PAIRING_KEY);
  }
}

/** Moves the token an older version kept in `chrome.storage.local` into the secret area, leaving the address. */
export async function moveLegacyEditorPairing(area: SecretArea = secretArea()): Promise<void> {
  const stored = (await chrome.storage.local.get(PAIRING_KEY))[PAIRING_KEY] as { url?: unknown } | undefined;
  if (!stored || typeof stored !== 'object' || !('token' in stored)) return;
  await moveLegacySecret(area, 'editor', coercePairing(stored), () =>
    typeof stored.url === 'string'
      ? chrome.storage.local.set({ [PAIRING_KEY]: { url: stored.url } })
      : chrome.storage.local.remove(PAIRING_KEY),
  );
}

/** The host permission pattern for an editor's endpoint: its origin only. */
export function editorOriginPattern(pairing: EditorPairing): string {
  return `${new URL(pairing.url).origin}/*`;
}
