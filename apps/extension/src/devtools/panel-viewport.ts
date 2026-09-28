import type { LocatorIndexViewport } from '@piwitests/core/locator-index';
import { getActiveProjectOverride, resolveActiveProject } from '../shared/active-project.js';
import { getConnectionSettings, isConnected } from '../shared/connection-settings.js';
import { formatNumber, t } from '../shared/i18n.js';
import { getLocatorBranchOverride, resolveLocatorBranch } from '../shared/locator-branch.js';
import { getCachedLocatorIndex } from '../shared/locator-index-cache.js';
import { requestLocatorIndex } from '../shared/locator-index-refresh.js';

/**
 * The Piwi panel's viewport bar: open the inspected page in a new window at the
 * viewport of one of the project's Playwright projects, as the instance knows
 * them from its runs (the locator index's `viewports`), or at a size typed by
 * hand. The background worker sizes the window (`piwi-open-viewport`). In
 * Chrome and Edge, **In this tab** sets the tab's own viewport instead, through
 * the debugging protocol (`piwi-set-tab-viewport`), until it is reset.
 */

/** The inspected tab: its id, and its address as the page reads it (DevTools pages hold no `activeTab` grant). */
export interface ViewportTab {
  id: number;
  url: string;
}

const TAB_VIEWPORT_KEY = 'piwiTabViewport';

const CUSTOM = 'custom';

/** The active project's viewports: from the cached locator index, refreshed through the worker when it has none. */
async function projectViewports(url: string | undefined): Promise<LocatorIndexViewport[]> {
  const connection = await getConnectionSettings();
  if (!isConnected(connection)) return [];
  const override = await getActiveProjectOverride().catch(() => null);
  const project = url ? resolveActiveProject(connection, override, url) : override;
  if (!project) return [];
  const branch = resolveLocatorBranch(
    project,
    await getLocatorBranchOverride(project.projectId).catch(() => undefined),
  );
  const cached = await getCachedLocatorIndex(project.projectId, branch);
  if (cached) return cached.index.viewports ?? [];
  const fresh = await requestLocatorIndex(project.projectId, { branch });
  return fresh.ok && fresh.index ? (fresh.index.viewports ?? []) : [];
}

export async function setUpViewportRow(tab: () => Promise<ViewportTab>, report: (text: string) => void): Promise<void> {
  const form = document.getElementById('viewport-row') as HTMLFormElement;
  const select = document.getElementById('viewport') as HTMLSelectElement;
  const custom = document.getElementById('viewport-custom') as HTMLElement;
  const width = document.getElementById('viewport-width') as HTMLInputElement;
  const height = document.getElementById('viewport-height') as HTMLInputElement;

  const current = await tab();
  const viewports = await projectViewports(current.url).catch(() => []);
  const options = viewports.map((v, i) => {
    const option = document.createElement('option');
    option.value = String(i);
    option.textContent = t('popup_viewportProject', {
      project: v.project,
      size: `${formatNumber(v.width)}×${formatNumber(v.height)}`,
    });
    return option;
  });
  const customOption = document.createElement('option');
  customOption.value = CUSTOM;
  customOption.textContent = t('popup_viewportCustom');
  select.replaceChildren(...options, customOption);
  const showCustom = () => {
    custom.hidden = select.value !== CUSTOM;
  };
  select.addEventListener('change', showCustom);
  showCustom();

  const chosenSize = () => {
    const chosen = select.value === CUSTOM ? null : viewports[Number(select.value)];
    return chosen
      ? { width: chosen.width, height: chosen.height }
      : { width: Number(width.value), height: Number(height.value) };
  };

  const here = document.getElementById('viewport-here') as HTMLButtonElement;
  const currentRow = document.getElementById('viewport-current') as HTMLElement;
  const currentText = document.getElementById('viewport-current-text') as HTMLElement;
  const reset = document.getElementById('viewport-reset') as HTMLButtonElement;
  // Only where the browser gives extensions the debugging protocol.
  here.hidden = typeof chrome.debugger?.attach !== 'function';
  const showCurrent = async () => {
    const page = await tab();
    const values: Record<string, unknown> = await chrome.storage.session.get(TAB_VIEWPORT_KEY).catch(() => ({}));
    const all = values[TAB_VIEWPORT_KEY] as Record<string, { width: number; height: number }> | undefined;
    const stored = all?.[page.id];
    currentRow.hidden = !stored;
    if (stored && !currentRow.hidden) {
      currentText.textContent = t('popup_viewportHereOn', {
        size: `${formatNumber(stored.width)}×${formatNumber(stored.height)}`,
      });
    }
  };
  await showCurrent();
  here.addEventListener('click', () => {
    void (async () => {
      const page = await tab();
      const reply = (await chrome.runtime
        .sendMessage({ type: 'piwi-set-tab-viewport', tabId: page.id, ...chosenSize() })
        .catch(() => null)) as { ok: boolean; error?: string } | null;
      if (reply?.ok) await showCurrent();
      else report(reply?.error ?? t('common_workerNoAnswer'));
    })();
  });
  reset.addEventListener('click', () => {
    void (async () => {
      const page = await tab();
      await chrome.runtime.sendMessage({ type: 'piwi-clear-tab-viewport', tabId: page.id }).catch(() => null);
      await showCurrent();
    })();
  });

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const size = chosenSize();
    void (async () => {
      const page = await tab();
      const reply = (await chrome.runtime
        .sendMessage({ type: 'piwi-open-viewport', url: page.url, ...size })
        .catch(() => null)) as { ok: boolean; error?: string } | null;
      if (!reply?.ok) report(reply?.error ?? t('common_workerNoAnswer'));
    })();
  });
}
