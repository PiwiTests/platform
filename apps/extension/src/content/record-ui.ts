/** The recorder's page surfaces, shared by `record-panel.ts` and `bug-panel.ts`. */

export const HUD_HOST_ID = 'piwi-record-hud-host';
export const PANEL_HOST_ID = 'piwi-record-review-host';
export const FRAME_HOST_ID = 'piwi-record-frame-host';
/** A bug recording's dialogs (what is wrong, what is missing, which page), above the HUD. */
export const BUG_DIALOG_HOST_ID = 'piwi-bug-dialog-host';

export const OWN_HOST_IDS: ReadonlySet<string> = new Set([
  HUD_HOST_ID,
  PANEL_HOST_ID,
  FRAME_HOST_ID,
  BUG_DIALOG_HOST_ID,
]);

export const SHARED_STYLE = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: ui-sans-serif, system-ui, -apple-system, sans-serif; }
`;

/** Whether an element belongs to the recorder's own UI rather than to the page. */
export function isOwnHost(element: Element): boolean {
  return OWN_HOST_IDS.has(element.id);
}

export async function copyToClipboard(text: string, btn: HTMLButtonElement): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    return;
  }
  const original = btn.textContent;
  btn.textContent = 'Copied';
  setTimeout(() => {
    btn.textContent = original;
  }, 1200);
}

/** Save a file through the page's own download handling. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  link.style.display = 'none';
  document.documentElement.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

/** `2026-09-27-14-03`, for file names. */
export function fileStamp(time: number): string {
  return new Date(time || Date.now()).toISOString().slice(0, 16).replace(/[:T]/g, '-');
}
