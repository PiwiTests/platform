import type { LocatorIndexViewport } from '@piwitests/core/locator-index';
import { getActiveProjectOverride, resolveActiveProject } from '../shared/active-project.js';
import { getConnectionSettings, isConnected } from '../shared/connection-settings.js';
import { formatNumber, t } from '../shared/i18n.js';
import { getLocatorBranchOverride, resolveLocatorBranch } from '../shared/locator-branch.js';
import { getCachedLocatorIndex } from '../shared/locator-index-cache.js';
import { requestLocatorIndex } from '../shared/locator-index-refresh.js';

/**
 * The popup's viewport row: open the tab's page in a new window at the
 * viewport of one of the project's Playwright projects, as the instance knows
 * them from its runs (the locator index's `viewports`), or at a size typed by
 * hand. The background worker sizes the window (`piwi-open-viewport`).
 */

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

export async function setUpViewportRow(
  tab: () => Promise<chrome.tabs.Tab | null>,
  report: (text: string) => void,
): Promise<void> {
  const form = document.getElementById('viewport-row') as HTMLFormElement;
  const select = document.getElementById('viewport') as HTMLSelectElement;
  const custom = document.getElementById('viewport-custom') as HTMLElement;
  const width = document.getElementById('viewport-width') as HTMLInputElement;
  const height = document.getElementById('viewport-height') as HTMLInputElement;

  const current = await tab();
  const viewports = await projectViewports(current?.url).catch(() => []);
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

  form.addEventListener('submit', (event) => {
    event.preventDefault();
    const chosen = select.value === CUSTOM ? null : viewports[Number(select.value)];
    const size = chosen ?? { width: Number(width.value), height: Number(height.value) };
    void (async () => {
      const page = await tab();
      const reply = (await chrome.runtime
        .sendMessage({ type: 'piwi-open-viewport', url: page?.url ?? '', ...size })
        .catch(() => null)) as { ok: boolean; error?: string } | null;
      if (reply?.ok) window.close();
      else report(reply?.error ?? t('common_workerNoAnswer'));
    })();
  });
}
