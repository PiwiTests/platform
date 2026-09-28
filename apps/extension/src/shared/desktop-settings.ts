/**
 * The optional pairing with the Piwi Dashboard desktop app: its loopback
 * address and access token, which **Pair** receives once the developer allows
 * it in the app's window, or which are pasted from the app's **Connect Piwi
 * Picker** (the extension cannot read `~/.piwi/desktop.json`).
 * `chrome.storage.local`, like the instance connection. Used only by the
 * background worker, for **Run with Playwright**, and by the options page.
 */
export interface DesktopSettings {
  /** The app's origin, such as `http://127.0.0.1:4318`. */
  url: string;
  token: string;
}

const DESKTOP_KEY = 'piwiDesktop';

/**
 * The address the desktop app takes when it is free (`PREFERRED_PORT` in
 * `apps/desktop/src-tauri/src/lib.rs`); another program on that port moves the
 * app to one its Setup page shows.
 */
export const DESKTOP_DEFAULT_URL = 'http://127.0.0.1:3000';

/**
 * The origin of a desktop app address, or null for anything that is not
 * plain http on this machine's loopback: the app binds nowhere else.
 */
export function desktopOrigin(input: string): string | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  if (url.protocol !== 'http:') return null;
  if (!['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname)) return null;
  return url.origin;
}

export function coerceDesktopSettings(value: unknown): DesktopSettings | null {
  const v = value as Partial<DesktopSettings> | null;
  if (!v || typeof v.url !== 'string' || typeof v.token !== 'string') return null;
  const url = desktopOrigin(v.url);
  const token = v.token.trim();
  return url && token ? { url, token } : null;
}

export async function getDesktopSettings(): Promise<DesktopSettings | null> {
  const stored = await chrome.storage.local.get(DESKTOP_KEY);
  return coerceDesktopSettings(stored[DESKTOP_KEY]);
}

export async function setDesktopSettings(settings: DesktopSettings): Promise<void> {
  await chrome.storage.local.set({ [DESKTOP_KEY]: settings });
}

export async function clearDesktopSettings(): Promise<void> {
  await chrome.storage.local.remove(DESKTOP_KEY);
}
