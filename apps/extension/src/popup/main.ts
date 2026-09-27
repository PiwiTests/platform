import {
  getRecordingState,
  stopRecording,
  setRecordIntent,
  clearRecordIntent,
  recordingMode,
  type RecordingMode,
} from '../shared/recording-storage.js';
import { getConnectionSettings, isConnected, mappedProjects } from '../shared/connection-settings.js';
import { getActiveProjectOverride, setActiveProjectOverride, resolveActiveProject } from '../shared/active-project.js';
import { workerState } from '../shared/worker-status.js';
import { initI18n, localizeDocument, t, tn, tNodes, formatNumber } from '../shared/i18n.js';
import { injectionFailureText } from '../shared/injection-failure.js';

await initI18n();
localizeDocument();
// The "running" mark after a tile's label is drawn by CSS.
document.documentElement.style.setProperty('--piwi-running', JSON.stringify(` ·  ${t('popup_running')}`));

const statusEl = document.getElementById('status')!;
const recordBtn = document.getElementById('record') as HTMLButtonElement;
const recordLabel = document.getElementById('record-label')!;
const recordHint = document.getElementById('record-hint')!;
const configButton = document.getElementById('config-button') as HTMLButtonElement;
const activeProjectRow = document.getElementById('active-project-row')!;
const activeProjectSelect = document.getElementById('active-project') as HTMLSelectElement;
const addSiteRow = document.getElementById('add-site-row') as HTMLElement;
const addSiteButton = document.getElementById('add-site') as HTMLButtonElement;
const coverageButton = document.getElementById('coverage-overlay') as HTMLButtonElement;
const coverageHint = document.getElementById('coverage-hint')!;
const bugBtn = document.getElementById('report-bug') as HTMLButtonElement;
const bugLabel = document.getElementById('report-bug-label')!;
const bugHint = document.getElementById('report-bug-hint')!;
/** Set once the connection settings are read: "Tested elements" needs a Piwi instance. */
let connected = false;

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function inject(file: string): Promise<void> {
  const tab = await activeTab();
  if (tab?.id == null) {
    statusEl.textContent = t('popup_noTab');
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
    window.close();
  } catch (error) {
    statusEl.textContent = injectionFailureText(error, tab.url);
  }
}

document.getElementById('pick')!.addEventListener('click', () => void inject('pick.js'));
document.getElementById('hover-inspect')!.addEventListener('click', () => void inject('hover-inspect.js'));
document.getElementById('locator-console')!.addEventListener('click', () => void inject('locator-console.js'));
document.getElementById('multi-pick')!.addEventListener('click', () => void inject('multi-pick.js'));
document.getElementById('lint-overlay')!.addEventListener('click', () => void inject('lint-overlay.js'));
document.getElementById('playwright-view')!.addEventListener('click', () => void inject('playwright-view.js'));
document.getElementById('assertion-panel')!.addEventListener('click', () => void inject('assertion-panel.js'));
document.getElementById('session-panel')!.addEventListener('click', () => void inject('session-panel.js'));
document.getElementById('agent-context-panel')!.addEventListener('click', () => void inject('agent-context-panel.js'));
document.getElementById('test-function-panel')!.addEventListener('click', () => void inject('test-function-panel.js'));
coverageButton.addEventListener('click', () => {
  // Without a connection there is no locator index to show: go straight to where it is set up.
  if (connected) void inject('coverage-overlay.js');
  else chrome.runtime.openOptionsPage();
});

configButton.addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

/**
 * Digit shortcuts for the action grid, in the order the tiles are rendered —
 * the `kbd` badge on each tile and its `aria-keyshortcuts` must stay in step
 * with this. Scoped to the popup rather than declared as `chrome.commands`,
 * which caps a extension at four user-visible shortcuts and would burn
 * global browser-wide bindings on actions that only make sense with this
 * popup open.
 */
const KEY_TO_ACTION_ID: Record<string, string> = {
  '1': 'record',
  '2': 'pick',
  '3': 'hover-inspect',
  '4': 'locator-console',
  '5': 'multi-pick',
  '6': 'lint-overlay',
  '7': 'assertion-panel',
  '8': 'session-panel',
  '9': 'agent-context-panel',
  '0': 'test-function-panel',
};

/**
 * Marks the tile whose tool is currently running in the active tab.
 *
 * Read live from the page rather than tracked here or in the worker: the tool
 * lives in the content script's world and ends on its own (Escape, closing a
 * panel, a navigation), so any copy kept elsewhere would go stale the moment
 * it mattered. Injecting the probe needs no extra permission — opening the
 * popup is itself the `activeTab` grant, the same one the tool buttons use.
 */
async function highlightActiveTool(): Promise<void> {
  const tab = await activeTab();
  if (tab?.id == null) return;
  let active: string | null = null;
  try {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => (globalThis as { __piwiActiveTool?: { id: string } }).__piwiActiveTool?.id ?? null,
    });
    active = (result?.result as string | null) ?? null;
  } catch {
    // Restricted page, or nothing injected yet — nothing is running either way.
    return;
  }
  for (const button of document.querySelectorAll<HTMLElement>('.actions button, button.feature')) {
    const running = button.id === active;
    button.classList.toggle('running', running);
    // Conveys the same thing the ring does, for anyone not seeing the ring.
    if (running) button.setAttribute('aria-current', 'true');
    else button.removeAttribute('aria-current');
  }
}

/**
 * Reports the *actual* binding for the pick shortcut rather than the one the
 * manifest suggests. A browser only assigns `suggested_key` when it is free —
 * another extension (or, on Firefox, the built-in Network Monitor) already
 * holding Ctrl+Shift+E means ours is silently left unbound, and hardcoding the
 * hint made that look like the extension was broken.
 */
async function renderPickShortcutHint(): Promise<void> {
  const el = document.getElementById('pick-shortcut');
  if (!el) return;
  let shortcut = '';
  try {
    const commands = await chrome.commands.getAll();
    shortcut = commands.find((c) => c.name === 'pick-element')?.shortcut ?? '';
  } catch {
    // `chrome.commands` unavailable — leave the fallback link below.
  }

  el.replaceChildren();
  if (shortcut) {
    const key = document.createElement('kbd');
    key.textContent = shortcut;
    el.append(...tNodes('popup_pickShortcut', { shortcut: key }));
    return;
  }
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = t('popup_noPickShortcut');
  link.addEventListener('click', (e) => {
    e.preventDefault();
    // chrome:// URLs can't be opened with a plain link from an extension page.
    void chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
  el.appendChild(link);
}

document.addEventListener('keydown', (e) => {
  // Let a modified key through — Ctrl+1 etc. belong to the browser — and stay
  // out of the way of the project select, where digits drive its own typeahead.
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const target = e.target as HTMLElement | null;
  if (target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
  const id =
    e.key === 't' || e.key === 'T'
      ? 'coverage-overlay'
      : e.key === 'b' || e.key === 'B'
        ? 'report-bug'
        : e.key === 'r' || e.key === 'R'
          ? 'replay-bug'
          : e.key === 'v' || e.key === 'V'
            ? 'playwright-view'
            : KEY_TO_ACTION_ID[e.key];
  if (!id) return;
  e.preventDefault();
  document.getElementById(id)?.click();
});

const AUTO_OPTION_VALUE = '';

/** Populates and pre-selects the active-project picker: hidden until connected, otherwise offering every mapped project plus "Auto" (clears the manual override, falling back to URL-pattern matching). */
async function refreshActiveProjectSelect(): Promise<void> {
  const [connection, override, tab] = await Promise.all([
    getConnectionSettings(),
    getActiveProjectOverride(),
    activeTab(),
  ]);

  connected = isConnected(connection);
  coverageHint.textContent = connected ? t('popup_testedElementsHint') : t('popup_testedElementsConnect');
  if (!connected) {
    // Connected to an instance that has no pattern yet: only the offer to add this site.
    const reachable = connection.instanceUrl.trim() !== '' && connection.serverSyncedAt > 0;
    activeProjectRow.style.display = reachable ? '' : 'none';
    activeProjectRow.classList.toggle('only-add-site', reachable);
    if (reachable) renderAddSite(tab?.url, true);
    return;
  }
  activeProjectRow.style.display = '';
  activeProjectRow.classList.remove('only-add-site');

  const options = mappedProjects(connection);
  const resolved = tab?.url ? resolveActiveProject(connection, override, tab.url) : override;
  if (resolved && !options.some((o) => o.projectId === resolved.projectId)) {
    options.push({ projectId: resolved.projectId, projectLabel: resolved.projectLabel });
  }

  activeProjectSelect.innerHTML = '';
  const autoOpt = document.createElement('option');
  autoOpt.value = AUTO_OPTION_VALUE;
  autoOpt.textContent =
    tab?.url && resolveActiveProject(connection, null, tab.url) ? t('popup_autoMatched') : t('popup_autoNoMatch');
  activeProjectSelect.appendChild(autoOpt);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o.projectId);
    opt.textContent = o.projectLabel;
    activeProjectSelect.appendChild(opt);
  }
  activeProjectSelect.value = override ? String(override.projectId) : AUTO_OPTION_VALUE;
  renderAddSite(tab?.url, !resolveActiveProject(connection, null, tab?.url ?? ''));

  activeProjectSelect.addEventListener('change', () => {
    void (async () => {
      if (activeProjectSelect.value === AUTO_OPTION_VALUE) {
        await setActiveProjectOverride(null);
        return;
      }
      const projectId = Number(activeProjectSelect.value);
      const projectLabel = activeProjectSelect.selectedOptions[0]?.textContent ?? `#${projectId}`;
      await setActiveProjectOverride({ projectId, projectLabel });
    })();
  });
}

/**
 * When no pattern covers the tab's site, offers to add one: the settings open
 * with `https://<host>/**` filled in, where it goes to the instance or stays in
 * this browser.
 */
function renderAddSite(url: string | undefined, unmatched: boolean): void {
  let origin: string | null = null;
  try {
    const parsed = new URL(url ?? '');
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') origin = parsed.origin;
  } catch {
    // Not a page a pattern could cover.
  }
  addSiteRow.hidden = !(unmatched && origin);
  addSiteButton.onclick = () => {
    if (!origin) return;
    const target = `${chrome.runtime.getURL('options.html')}#add=${encodeURIComponent(`${origin}/**`)}`;
    void chrome.tabs.create({ url: target }).then(() => window.close());
  };
}

type RecordUiState = 'idle' | 'recording' | 'stopped';

/**
 * The record button's state and the tab it applies to, resolved once on open.
 *
 * Held here rather than read inside the click handler because starting a
 * recording has to call `chrome.permissions.request` while the click's user
 * gesture is still live — Firefox rejects the call outright from anywhere
 * else, and `options/main.ts` documents the same constraint for the instance
 * origin. Reading storage or querying tabs first would spend the gesture on an
 * await. The button stays disabled until this is populated, so a click can
 * never act on a state that hasn't loaded.
 */
let uiState: RecordUiState = 'idle';
let uiMode: RecordingMode = 'actions';
let recordTab: chrome.tabs.Tab | null = null;

async function recordUiState(): Promise<{ state: RecordUiState; mode: RecordingMode; steps: number }> {
  const rec = await getRecordingState();
  const mode = recordingMode(rec);
  if (rec.active) return { state: 'recording', mode, steps: rec.events.length };
  if (rec.events.length > 0) return { state: 'stopped', mode, steps: rec.events.length };
  return { state: 'idle', mode: 'actions', steps: 0 };
}

async function refreshRecordButton(): Promise<void> {
  const [{ state, mode, steps }, tab] = await Promise.all([recordUiState(), activeTab()]);
  uiState = state;
  uiMode = mode;
  recordTab = tab;
  const bug = mode === 'bug';
  const count = formatNumber(steps);
  if (state === 'recording') {
    recordLabel.textContent = bug ? t('popup_finishBugReport', { count }) : t('popup_stopRecording', { count });
    recordHint.textContent = t('popup_stepsSoFar');
  } else if (state === 'stopped') {
    recordLabel.textContent = bug ? t('popup_reviewBugReport') : t('popup_reviewRecording', { count });
    recordHint.textContent = t('popup_notExported');
  } else {
    recordLabel.textContent = t('popup_record');
    recordHint.textContent = t('popup_recordHint');
  }
  recordBtn.disabled = false;

  if (state === 'recording' && bug) {
    bugLabel.textContent = t('popup_takeScreenshot');
    bugHint.textContent = tn('popup_screenshotHint', steps);
  } else if (state === 'stopped' && bug) {
    bugLabel.textContent = t('popup_reviewBugReport');
    bugHint.textContent = t('popup_reviewBugReportHint');
  } else if (state !== 'idle') {
    bugLabel.textContent = t('popup_reportBug');
    bugHint.textContent = t('popup_finishFirst');
  } else {
    bugLabel.textContent = t('popup_reportBug');
    bugHint.textContent = t('popup_reportBugHint');
  }
  bugBtn.disabled = false;
}

/** The host permission a recording on `url` needs, or null when the page can't be recorded at all. */
function recordOriginPattern(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const { origin } = new URL(url);
    return origin === 'null' ? null : `${origin}/*`;
  } catch {
    return null;
  }
}

async function startRecordingFlow(
  originPattern: string,
  tabId: number,
  mode: RecordingMode,
  granted: Promise<boolean>,
): Promise<void> {
  if (!(await granted)) {
    // Drop the intent the click parked for the worker, so a later unrelated
    // grant for this same origin can't revive a recording the user declined.
    await clearRecordIntent().catch(() => undefined);
    statusEl.textContent = t('popup_permissionNeeded');
    return;
  }

  const response = (await chrome.runtime.sendMessage({
    type: 'piwi-start-recording',
    originPattern,
    tabId,
    mode,
  })) as {
    ok: boolean;
    error?: string;
  };
  if (!response?.ok) {
    statusEl.textContent = response?.error ?? t('common_recordingStartFailed');
    return;
  }
  window.close();
}

async function stopRecordingFlow(): Promise<void> {
  await stopRecording();
  try {
    // The worker owns the fan-out that tears the HUD and border down in every
    // tab this recording touched — see `notifyRecorderTabs` in background.
    await chrome.runtime.sendMessage({ type: 'piwi-recording-stopped' });
  } catch {
    // Background may already be asleep between messages — the storage write above already stuck.
  }
  // Injecting rather than relying on that fan-out for the review panel itself:
  // this tab may never have had the recorder attached, and the panel is what
  // the user clicked Stop to get.
  await inject('record-panel.js');
}

async function reviewRecordingFlow(): Promise<void> {
  await inject('record-panel.js');
}

/**
 * Starts a recording of `mode` on the popup's tab. Synchronous up to the
 * permission request, which must run inside the click's user gesture.
 */
function requestRecording(mode: RecordingMode): void {
  const originPattern = recordOriginPattern(recordTab?.url);
  if (originPattern == null || recordTab?.id == null) {
    statusEl.textContent = t('popup_cannotRecord');
    return;
  }
  const tabId = recordTab.id;
  // Synchronous, before any await: this is the user gesture the request needs.
  let granted: Promise<boolean>;
  try {
    granted = chrome.permissions.request({ origins: [originPattern] });
  } catch {
    statusEl.textContent = t('popup_permissionNeeded');
    return;
  }
  // Park the intent so the background can still start the recording if this
  // popup is torn down when the prompt takes focus — the first-time grant that
  // used to leave the recorder needing a second click. Fire-and-forget: it must
  // not delay the request above, and `startRecordingFlow` still starts things
  // directly whenever the popup does survive.
  void setRecordIntent({ originPattern, tabId, mode });
  void startRecordingFlow(originPattern, tabId, mode, granted);
}

recordBtn.addEventListener('click', () => {
  if (uiState === 'recording') {
    void stopRecordingFlow();
    return;
  }
  if (uiState === 'stopped') {
    void reviewRecordingFlow();
    return;
  }
  requestRecording('actions');
});

/**
 * Report a bug: starts a bug recording, or during one asks the page for a
 * screenshot. Opening this popup is what grants `activeTab`, the only grant
 * under which Chrome allows one.
 */
async function bugScreenshotFlow(): Promise<void> {
  const tab = await activeTab();
  if (tab?.id == null) return;
  try {
    await chrome.tabs.sendMessage(tab.id, { type: 'piwi-bug-take-screenshot' });
    window.close();
  } catch {
    statusEl.textContent = t('popup_notRecordedTab');
  }
}

bugBtn.addEventListener('click', () => {
  if (uiState === 'recording' && uiMode === 'bug') {
    void bugScreenshotFlow();
    return;
  }
  if (uiState === 'stopped' && uiMode === 'bug') {
    void reviewRecordingFlow();
    return;
  }
  if (uiState !== 'idle') {
    statusEl.textContent = t('popup_finishBeforeBug');
    return;
  }
  requestRecording('bug');
});

/**
 * Replay a bug report: asks for this site's permission (inside the click, the
 * only place the request counts as the user's), which the replay needs to
 * continue across pages, and opens the replay's chooser in the tab under the
 * `activeTab` grant opening the popup gave.
 */
document.getElementById('replay-bug')!.addEventListener('click', () => {
  const originPattern = recordOriginPattern(recordTab?.url);
  if (originPattern == null || recordTab?.id == null) {
    statusEl.textContent = t('popup_cannotReplay');
    return;
  }
  void chrome.permissions.request({ origins: [originPattern] }).catch(() => false);
  void inject('replay-panel.js');
});

/** Offer a reload when the background worker predates this popup's build (see `shared/build-id.ts`). */
async function showOutdatedWorkerNotice(): Promise<void> {
  if ((await workerState()) !== 'outdated') return;
  const notice = document.getElementById('worker-notice')!;
  notice.hidden = false;
  document.getElementById('worker-reload')!.addEventListener('click', () => chrome.runtime.reload());
}

recordBtn.disabled = true;
bugBtn.disabled = true;
void refreshRecordButton().catch(() => {
  // Left disabled on purpose: acting on a state we failed to read could start a
  // second recording over a live one.
  statusEl.textContent = t('popup_stateUnreadable');
});
void refreshActiveProjectSelect();
void renderPickShortcutHint();
void highlightActiveTool();
void showOutdatedWorkerNotice();
