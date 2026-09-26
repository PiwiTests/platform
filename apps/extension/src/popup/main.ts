import { getRecordingState, stopRecording, setRecordIntent, clearRecordIntent } from '../shared/recording-storage.js';
import { getConnectionSettings, isConnected, type ProjectMapping } from '../shared/connection-settings.js';
import { getActiveProjectOverride, setActiveProjectOverride, resolveActiveProject } from '../shared/active-project.js';
import { workerState } from '../shared/worker-status.js';

const statusEl = document.getElementById('status')!;
const recordBtn = document.getElementById('record') as HTMLButtonElement;
const recordLabel = document.getElementById('record-label')!;
const recordHint = document.getElementById('record-hint')!;
const configButton = document.getElementById('config-button') as HTMLButtonElement;
const activeProjectRow = document.getElementById('active-project-row')!;
const activeProjectSelect = document.getElementById('active-project') as HTMLSelectElement;
const coverageButton = document.getElementById('coverage-overlay') as HTMLButtonElement;
const coverageHint = document.getElementById('coverage-hint')!;
/** Set once the connection settings are read: "Tested elements" needs a Piwi instance. */
let connected = false;

async function activeTab(): Promise<chrome.tabs.Tab | null> {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab ?? null;
}

async function inject(file: string): Promise<void> {
  const tab = await activeTab();
  if (tab?.id == null) {
    statusEl.textContent = 'No active tab to pick from.';
    return;
  }
  try {
    await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: [file] });
    window.close();
  } catch {
    statusEl.textContent = "Can't run on this page (browser/store pages are off-limits to extensions).";
  }
}

document.getElementById('pick')!.addEventListener('click', () => void inject('pick.js'));
document.getElementById('hover-inspect')!.addEventListener('click', () => void inject('hover-inspect.js'));
document.getElementById('locator-console')!.addEventListener('click', () => void inject('locator-console.js'));
document.getElementById('multi-pick')!.addEventListener('click', () => void inject('multi-pick.js'));
document.getElementById('lint-overlay')!.addEventListener('click', () => void inject('lint-overlay.js'));
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
    el.append(key, ' picks without the popup');
    return;
  }
  const link = document.createElement('a');
  link.href = '#';
  link.textContent = 'no pick shortcut assigned — set one';
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
  const id = e.key === 't' || e.key === 'T' ? 'coverage-overlay' : KEY_TO_ACTION_ID[e.key];
  if (!id) return;
  e.preventDefault();
  document.getElementById(id)?.click();
});

const AUTO_OPTION_VALUE = '';

function dedupeMappings(mappings: ProjectMapping[]): Array<{ projectId: number; projectLabel: string }> {
  const seen = new Map<number, string>();
  for (const m of mappings) if (!seen.has(m.projectId)) seen.set(m.projectId, m.projectLabel);
  return [...seen].map(([projectId, projectLabel]) => ({ projectId, projectLabel }));
}

/** Populates and pre-selects the active-project picker: hidden until connected, otherwise offering every mapped project plus "Auto" (clears the manual override, falling back to URL-pattern matching). */
async function refreshActiveProjectSelect(): Promise<void> {
  const [connection, override, tab] = await Promise.all([
    getConnectionSettings(),
    getActiveProjectOverride(),
    activeTab(),
  ]);

  connected = isConnected(connection);
  coverageHint.textContent = connected
    ? 'What your tests reach on this page, and what they miss'
    : 'Connect to your Piwi instance to see what your tests reach';
  if (!connected) {
    activeProjectRow.style.display = 'none';
    return;
  }
  activeProjectRow.style.display = '';

  const options = dedupeMappings(connection.projectMappings);
  const resolved = tab?.url ? resolveActiveProject(connection, override, tab.url) : override;
  if (resolved && !options.some((o) => o.projectId === resolved.projectId)) {
    options.push({ projectId: resolved.projectId, projectLabel: resolved.projectLabel });
  }

  activeProjectSelect.innerHTML = '';
  const autoOpt = document.createElement('option');
  autoOpt.value = AUTO_OPTION_VALUE;
  autoOpt.textContent =
    tab?.url && resolveActiveProject(connection, null, tab.url)
      ? 'Auto (matched by URL)'
      : 'Auto (no match on this page)';
  activeProjectSelect.appendChild(autoOpt);
  for (const o of options) {
    const opt = document.createElement('option');
    opt.value = String(o.projectId);
    opt.textContent = o.projectLabel;
    activeProjectSelect.appendChild(opt);
  }
  activeProjectSelect.value = override ? String(override.projectId) : AUTO_OPTION_VALUE;

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
let recordTab: chrome.tabs.Tab | null = null;

async function recordUiState(): Promise<{ state: RecordUiState; steps: number }> {
  const rec = await getRecordingState();
  if (rec.active) return { state: 'recording', steps: rec.events.length };
  if (rec.events.length > 0) return { state: 'stopped', steps: rec.events.length };
  return { state: 'idle', steps: 0 };
}

async function refreshRecordButton(): Promise<void> {
  const [{ state, steps }, tab] = await Promise.all([recordUiState(), activeTab()]);
  uiState = state;
  recordTab = tab;
  if (state === 'recording') {
    recordLabel.textContent = `Stop recording (${steps})`;
    recordHint.textContent = 'Steps captured so far';
  } else if (state === 'stopped') {
    recordLabel.textContent = `Review recording (${steps})`;
    recordHint.textContent = 'Not exported yet';
  } else {
    recordLabel.textContent = 'Record actions';
    recordHint.textContent = 'Multi-page → TypeScript';
  }
  recordBtn.disabled = false;
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

async function startRecordingFlow(originPattern: string, tabId: number, granted: Promise<boolean>): Promise<void> {
  if (!(await granted)) {
    // Drop the intent the click parked for the worker, so a later unrelated
    // grant for this same origin can't revive a recording the user declined.
    await clearRecordIntent().catch(() => undefined);
    statusEl.textContent = 'Permission for this site is needed to record across pages.';
    return;
  }

  const response = (await chrome.runtime.sendMessage({
    type: 'piwi-start-recording',
    originPattern,
    tabId,
  })) as {
    ok: boolean;
    error?: string;
  };
  if (!response?.ok) {
    statusEl.textContent = response?.error ?? 'Failed to start recording.';
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

recordBtn.addEventListener('click', () => {
  if (uiState === 'recording') {
    void stopRecordingFlow();
    return;
  }
  if (uiState === 'stopped') {
    void reviewRecordingFlow();
    return;
  }

  const originPattern = recordOriginPattern(recordTab?.url);
  if (originPattern == null || recordTab?.id == null) {
    statusEl.textContent = "Can't record on this page.";
    return;
  }
  const tabId = recordTab.id;
  // Synchronous, before any await: this is the user gesture the request needs.
  let granted: Promise<boolean>;
  try {
    granted = chrome.permissions.request({ origins: [originPattern] });
  } catch {
    statusEl.textContent = 'Permission for this site is needed to record across pages.';
    return;
  }
  // Park the intent so the background can still start the recording if this
  // popup is torn down when the prompt takes focus — the first-time grant that
  // used to leave the recorder needing a second click. Fire-and-forget: it must
  // not delay the request above, and `startRecordingFlow` still starts things
  // directly whenever the popup does survive.
  void setRecordIntent({ originPattern, tabId });
  void startRecordingFlow(originPattern, tabId, granted);
});

/** Offer a reload when the background worker predates this popup's build (see `shared/build-id.ts`). */
async function showOutdatedWorkerNotice(): Promise<void> {
  if ((await workerState()) !== 'outdated') return;
  const notice = document.getElementById('worker-notice')!;
  notice.hidden = false;
  document.getElementById('worker-reload')!.addEventListener('click', () => chrome.runtime.reload());
}

recordBtn.disabled = true;
void refreshRecordButton().catch(() => {
  // Left disabled on purpose: acting on a state we failed to read could start a
  // second recording over a live one.
  statusEl.textContent = "Couldn't read the recorder state — reopen the popup.";
});
void refreshActiveProjectSelect();
void renderPickShortcutHint();
void highlightActiveTool();
void showOutdatedWorkerNotice();
