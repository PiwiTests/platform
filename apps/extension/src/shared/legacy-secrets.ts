import { moveLegacyApiKey } from './connection-settings.js';
import { moveLegacyDesktopSettings } from './desktop-settings.js';
import { moveLegacyEditorPairing } from './editor-pairing.js';

/**
 * Moves every secret an older version kept in `chrome.storage.local` into the
 * secret area (`secret-store.ts`): run as the background worker starts and as
 * the settings page opens. Each read of a secret moves its own first too, so a
 * move that failed here is made on the next read.
 */
export async function moveLegacySecrets(): Promise<void> {
  await Promise.allSettled([moveLegacyApiKey(), moveLegacyDesktopSettings(), moveLegacyEditorPairing()]);
}
