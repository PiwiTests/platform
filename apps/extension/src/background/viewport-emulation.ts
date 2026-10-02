import { sendCommand } from './debugger.js';

/**
 * A viewport size set on a tab through the debugging protocol, in CSS pixels
 * as the page measures them (`innerWidth`, `innerHeight`). The protocol takes
 * device-independent pixels, which the browser's zoom divides: at 125%, a
 * 400-pixel override leaves the page 320 CSS pixels. So the size is scaled by
 * the tab's zoom, and set again when the zoom changes.
 */

export interface CssViewport {
  width: number;
  height: number;
}

/**
 * The viewport a replay set on each tab: set again when the tab's zoom
 * changes, kept when the DevTools panel's own viewport is cleared meanwhile,
 * given back when the replay lets the tab go.
 */
export const replayViewports = new Map<number, CssViewport>();

/** The tab's zoom factor, 1 at 100%; 1 when the browser cannot say. */
export async function tabZoom(tabId: number): Promise<number> {
  try {
    const zoom = await chrome.tabs.getZoom(tabId);
    return Number.isFinite(zoom) && zoom > 0 ? zoom : 1;
  } catch {
    return 1;
  }
}

/** Sets the tab's viewport to `size` in CSS pixels, through its debugging session. Throws when the browser refuses. */
export async function emulateCssViewport(tabId: number, size: CssViewport): Promise<void> {
  const zoom = await tabZoom(tabId);
  await sendCommand(tabId, 'Emulation.setDeviceMetricsOverride', {
    width: Math.round(size.width * zoom),
    height: Math.round(size.height * zoom),
    deviceScaleFactor: 0,
    mobile: false,
  });
}

/** Calls `listener` with the tab whose zoom changed, so a size set on it can follow. */
export function onTabZoomChange(listener: (tabId: number) => void): void {
  chrome.tabs.onZoomChange?.addListener((info) => listener(info.tabId));
}
