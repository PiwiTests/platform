import { parsePairing } from '@piwitests/core/editor-send';
import { editorOriginPattern, getEditorPairing, setEditorPairing } from '../shared/editor-pairing.js';
import {
  getConnectionSettings,
  setConnectionSettings,
  clearConnectionSettings,
  applyServerSync,
  mappedProjects,
  type ConnectionSettings,
} from '../shared/connection-settings.js';
import {
  testConnection,
  fetchProjects,
  fetchCatalog,
  startConnect,
  pollConnect,
  fetchServerPatterns,
  addServerPattern,
  type ProjectOption,
} from '../shared/piwi-client.js';
import { waitForApproval } from '../shared/connect-flow.js';
import { describeClient } from '../shared/client-info.js';
import { setCachedCatalog, pruneCachedCatalogs } from '../shared/catalog-cache.js';
import {
  LANGUAGES,
  browserCatalogLanguage,
  chosenLanguage,
  initI18n,
  languageName,
  languageTag,
  localizeDocument,
  t,
  tn,
  tNodes,
  type Language,
} from '../shared/i18n.js';
import { isDraftLanguage, TRANSLATION_ISSUE_URL } from '../shared/languages.js';

await initI18n();
localizeDocument();

const instanceUrlEl = document.getElementById('instance-url') as HTMLInputElement;
const connectBtn = document.getElementById('connect') as HTMLButtonElement;
const connectPanel = document.getElementById('connect-panel') as HTMLElement;
const connectCodeLine = document.getElementById('connect-code-line')!;
const connectCancelBtn = document.getElementById('connect-cancel') as HTMLButtonElement;
const connectedAsEl = document.getElementById('connected-as') as HTMLElement;
const apiKeyFallback = document.getElementById('api-key-fallback') as HTMLDetailsElement;
const serverMappingsEl = document.getElementById('server-mappings')!;
const refreshServerBtn = document.getElementById('refresh-server') as HTMLButtonElement;
const addSiteEl = document.getElementById('add-site') as HTMLElement;
const addPatternEl = document.getElementById('add-pattern') as HTMLInputElement;
const addProjectEl = document.getElementById('add-project') as HTMLSelectElement;
const addEnvironmentEl = document.getElementById('add-environment') as HTMLInputElement;
const addBranchEl = document.getElementById('add-branch') as HTMLInputElement;
const addNoteEl = document.getElementById('add-note') as HTMLElement;
const addToServerBtn = document.getElementById('add-to-server') as HTMLButtonElement;
const addLocallyBtn = document.getElementById('add-locally') as HTMLButtonElement;
const apiKeyEl = document.getElementById('api-key') as HTMLInputElement;
const mappingsEl = document.getElementById('mappings')!;
const addMappingBtn = document.getElementById('add-mapping') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const testBtn = document.getElementById('test-connection') as HTMLButtonElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect') as HTMLButtonElement;
const languageSelect = document.getElementById('language') as HTMLSelectElement;
const draftNote = document.getElementById('language-draft') as HTMLElement;

interface EditableMapping {
  urlPattern: string;
  projectId: number | null;
  projectLabel: string;
  /** The branch deployed at those URLs; empty for the project's default branch. */
  branch: string;
}

/** Populated by "Test connection" (or on load, if already connected) — the pool a mapping row's project `<select>` draws from. */
let projectOptions: ProjectOption[] = [];
let mappings: EditableMapping[] = [];
/** The stored settings as last read or written: the instance's patterns and account name live here. */
let stored: ConnectionSettings = await getConnectionSettings();
/** Set while a Connect is waiting for the user to answer on the instance; aborting it stops the wait. */
let pendingConnect: AbortController | null = null;
/** Why the last read of the instance's patterns failed, shown under them; empty after a good read. */
let serverSyncError = '';

function setStatus(text: string, kind: 'ok' | 'error' | '' = ''): void {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function currentInstanceSettings(): ConnectionSettings {
  return { ...stored, instanceUrl: instanceUrlEl.value.trim(), apiKey: apiKeyEl.value.trim() };
}

/**
 * Grants this extension host access to the Piwi instance's own origin.
 *
 * Needed because the dashboard API doesn't send CORS headers, so a
 * cross-origin fetch from an extension context only succeeds with a host
 * permission. It matters most for the *background* refresh
 * (`piwi-refresh-catalog`): a service worker has no user gesture and so can
 * never request one itself, which would leave the catalog frozen at whatever
 * this page last fetched.
 *
 * `chrome.permissions.request` only counts while the user gesture is still
 * live, so callers must invoke this before awaiting anything else in the
 * click handler. Granted narrowly — the one instance origin, never the broad
 * http/https patterns the manifest declares as merely requestable.
 */
async function ensureInstanceHostPermission(instanceUrl: string): Promise<boolean> {
  let origin: string;
  try {
    origin = new URL(instanceUrl).origin;
  } catch {
    return false;
  }
  const originPattern = `${origin}/*`;
  if (await chrome.permissions.contains({ origins: [originPattern] })) return true;
  try {
    return await chrome.permissions.request({ origins: [originPattern] });
  } catch {
    return false;
  }
}

function renderMappings(): void {
  mappingsEl.innerHTML = '';

  if (mappings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-mappings';
    empty.textContent = t('options_noMappings');
    mappingsEl.appendChild(empty);
    return;
  }

  const knownIds = new Set(projectOptions.map((p) => p.id));

  mappings.forEach((mapping, index) => {
    const row = document.createElement('div');
    row.className = 'mapping-row';

    const patternInput = document.createElement('input');
    patternInput.type = 'text';
    patternInput.className = 'mapping-pattern';
    patternInput.placeholder = t('options_patternPlaceholder');
    patternInput.setAttribute('aria-label', t('options_pattern'));
    patternInput.value = mapping.urlPattern;
    patternInput.addEventListener('input', () => {
      mappings[index]!.urlPattern = patternInput.value;
    });

    const projectSelect = document.createElement('select');
    projectSelect.className = 'mapping-project';
    projectSelect.setAttribute('aria-label', t('options_project'));
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = projectOptions.length === 0 ? t('options_projectTestFirst') : t('options_projectChoose');
    projectSelect.appendChild(placeholder);
    // A mapping saved before the project list was (re-)fetched still names a real project — keep showing it even if it's not in `projectOptions` yet.
    if (mapping.projectId != null && !knownIds.has(mapping.projectId)) {
      const preserved = document.createElement('option');
      preserved.value = String(mapping.projectId);
      preserved.textContent = mapping.projectLabel;
      projectSelect.appendChild(preserved);
    }
    for (const p of projectOptions) {
      const opt = document.createElement('option');
      opt.value = String(p.id);
      opt.textContent = p.label || p.name;
      projectSelect.appendChild(opt);
    }
    projectSelect.value = mapping.projectId != null ? String(mapping.projectId) : '';
    projectSelect.addEventListener('change', () => {
      const id = projectSelect.value ? Number(projectSelect.value) : null;
      mappings[index]!.projectId = id;
      mappings[index]!.projectLabel = projectSelect.selectedOptions[0]?.textContent ?? '';
    });

    const branchInput = document.createElement('input');
    branchInput.type = 'text';
    branchInput.className = 'mapping-branch';
    branchInput.placeholder = t('options_branchPlaceholder');
    branchInput.title = t('options_branchTitle');
    branchInput.setAttribute('aria-label', t('options_branch'));
    branchInput.value = mapping.branch;
    branchInput.addEventListener('input', () => {
      mappings[index]!.branch = branchInput.value;
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-mapping';
    removeBtn.setAttribute('aria-label', t('options_removeMapping'));
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      mappings.splice(index, 1);
      renderMappings();
    });

    const source = document.createElement('span');
    source.className = 'source';
    source.textContent = t('options_sourceLocal');

    row.append(patternInput, projectSelect, branchInput, source, removeBtn);
    mappingsEl.appendChild(row);
  });
}

addMappingBtn.addEventListener('click', () => {
  mappings.push({ urlPattern: '', projectId: null, projectLabel: '', branch: '' });
  renderMappings();
});

/** "Connected as …" under the address, once a connection is known to work. */
function renderConnectedAs(): void {
  const connected = stored.instanceUrl.trim() !== '' && stored.serverSyncedAt > 0;
  connectedAsEl.hidden = !connected;
  connectedAsEl.textContent = !connected
    ? ''
    : stored.connectedAs
      ? t('options_connectedAs', { name: stored.connectedAs })
      : t('options_connectedNoAuth');
}

/** The instance's patterns, read-only, each marked as coming from the instance. */
function renderServerMappings(): void {
  serverMappingsEl.replaceChildren();
  if (serverSyncError) {
    const error = document.createElement('div');
    error.className = 'hint';
    error.textContent = t('options_serverSyncFailed', { error: serverSyncError });
    serverMappingsEl.appendChild(error);
  }
  if (stored.serverMappings.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty-mappings';
    empty.textContent = stored.serverSyncedAt > 0 ? t('options_serverEmpty') : t('options_serverNotRead');
    serverMappingsEl.appendChild(empty);
  }
  for (const mapping of stored.serverMappings) {
    const row = document.createElement('div');
    row.className = 'server-row';
    const pattern = document.createElement('span');
    pattern.className = 'pattern';
    pattern.textContent = mapping.urlPattern;
    const meta = document.createElement('span');
    meta.className = 'meta';
    meta.textContent = [mapping.projectLabel, mapping.environment, mapping.branch].filter(Boolean).join(' · ');
    const source = document.createElement('span');
    source.className = 'source';
    source.textContent = t('options_sourceServer');
    row.append(pattern, meta, source);
    serverMappingsEl.appendChild(row);
  }
  refreshServerBtn.hidden = !stored.instanceUrl.trim();
  renderAddSite();
}

/** The "Add a site" form: the projects the user may add patterns to, or why there are none. */
function renderAddSite(): void {
  addSiteEl.hidden = !stored.instanceUrl.trim() || stored.serverSyncedAt === 0;
  const editable = stored.serverProjects.filter((p) => p.canEdit);
  const previous = addProjectEl.value;
  addProjectEl.replaceChildren();
  const placeholder = document.createElement('option');
  placeholder.value = '';
  placeholder.textContent = t('options_projectChoose');
  addProjectEl.appendChild(placeholder);
  for (const project of editable) {
    const option = document.createElement('option');
    option.value = String(project.id);
    option.textContent = project.label;
    addProjectEl.appendChild(option);
  }
  if (editable.some((p) => String(p.id) === previous)) addProjectEl.value = previous;
  else if (editable.length === 1) addProjectEl.value = String(editable[0]!.id);
  addToServerBtn.disabled = editable.length === 0;
  addNoteEl.hidden = editable.length > 0;
  addNoteEl.textContent = editable.length > 0 ? '' : t('options_addNoEditable');
}

/**
 * Reads the instance's URL patterns into the stored settings. Keeps the
 * previous copy when the instance cannot be read, so resolving a page's
 * project keeps working offline.
 */
async function syncServerPatterns(settings: ConnectionSettings): Promise<boolean> {
  try {
    const answer = await fetchServerPatterns(settings);
    stored = applyServerSync({ ...(await getConnectionSettings()), ...pick(settings) }, answer, Date.now());
    await setConnectionSettings(stored);
    serverSyncError = '';
    return true;
  } catch (err) {
    serverSyncError = err instanceof Error ? err.message : String(err);
    return false;
  } finally {
    renderServerMappings();
    renderConnectedAs();
  }
}

/** The connection fields of `settings`: what a sync must not lose when it rewrites the stored copy. */
function pick(settings: ConnectionSettings): Pick<ConnectionSettings, 'instanceUrl' | 'apiKey'> {
  return { instanceUrl: settings.instanceUrl, apiKey: settings.apiKey };
}

/** Fetches and caches the function catalog of every mapped project; returns the counts the status line reports. */
async function refreshCatalogs(
  settings: ConnectionSettings,
): Promise<{ projects: number; functions: number; failed: number }> {
  const projectIds = mappedProjects(settings).map((p) => p.projectId);
  let functions = 0;
  let failed = 0;
  for (const projectId of projectIds) {
    try {
      const catalog = await fetchCatalog(settings, projectId);
      await setCachedCatalog(projectId, catalog);
      functions += catalog.length;
    } catch {
      failed++;
    }
  }
  await pruneCachedCatalogs(projectIds);
  return { projects: projectIds.length, functions, failed };
}

/** The mapping select's projects: the ones "Test connection" listed, else the ones the last sync read. */
function syncedProjectOptions(): ProjectOption[] {
  return stored.serverProjects.map((p) => ({ id: p.id, name: p.label, label: p.label }));
}

async function loadInitial(): Promise<void> {
  const settings = stored;
  instanceUrlEl.value = settings.instanceUrl;
  apiKeyEl.value = settings.apiKey;
  // A key typed by hand stays visible where it was typed.
  apiKeyFallback.open = settings.apiKey !== '' && settings.serverSyncedAt === 0;
  mappings = settings.projectMappings.map((m) => ({
    urlPattern: m.urlPattern,
    projectId: m.projectId,
    projectLabel: m.projectLabel,
    branch: m.branch ?? '',
  }));
  projectOptions = syncedProjectOptions();
  renderMappings();
  renderServerMappings();
  renderConnectedAs();
  prefillAddSite();

  if (settings.instanceUrl) {
    if (await syncServerPatterns(settings)) {
      projectOptions = syncedProjectOptions();
      renderMappings();
    }
    try {
      projectOptions = await fetchProjects(settings);
      renderMappings();
    } catch {
      // Instance unreachable at load time — leave placeholders; "Test connection" surfaces the error.
    }
  }
}

/** `options.html#add=<pattern>`, as the popup opens it for a site no pattern covers: fill the form in. */
function prefillAddSite(): void {
  const match = /^#add=(.+)$/.exec(location.hash);
  if (!match) return;
  try {
    addPatternEl.value = decodeURIComponent(match[1]!);
  } catch {
    return;
  }
  history.replaceState(null, '', location.pathname);
  requestAnimationFrame(() => {
    (addSiteEl.hidden ? addMappingBtn : addPatternEl).scrollIntoView({ block: 'center' });
    if (!addSiteEl.hidden) addPatternEl.focus();
  });
}

function setConnecting(active: boolean): void {
  connectBtn.disabled = active;
  connectPanel.hidden = !active;
  if (!active) connectCodeLine.replaceChildren();
}

connectBtn.addEventListener('click', () => {
  const instanceUrl = instanceUrlEl.value.trim();
  // Before any await, so the click still counts as the user gesture.
  const permission = ensureInstanceHostPermission(instanceUrl);
  void (async () => {
    if (!instanceUrl) {
      setStatus(t('common_enterInstanceUrl'), 'error');
      return;
    }
    if (!(await permission)) {
      setStatus(t('options_accessDenied'), 'error');
      return;
    }
    await connect(instanceUrl);
  })();
});

connectCancelBtn.addEventListener('click', () => {
  pendingConnect?.abort();
});

/**
 * Connects in one step: the instance shows a code on a page where the signed-in
 * user allows Piwi Picker, and the answer to the next poll carries an API key
 * created for them.
 */
async function connect(instanceUrl: string): Promise<void> {
  pendingConnect?.abort();
  const controller = new AbortController();
  pendingConnect = controller;
  setStatus(t('options_connectStarting'));
  let tabId: number | undefined;
  try {
    const start = await startConnect(instanceUrl, describeClient(navigator.userAgent));
    const code = document.createElement('code');
    code.textContent = start.userCode;
    connectCodeLine.replaceChildren(...tNodes('options_connectCode', { code }));
    setConnecting(true);
    setStatus('');
    tabId = (await chrome.tabs.create({ url: start.verificationUrl })).id;
    const outcome = await waitForApproval({
      poll: () => pollConnect(instanceUrl, start.deviceCode),
      interval: start.interval,
      expiresIn: start.expiresIn,
      sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
      now: () => Date.now(),
      signal: controller.signal,
    });
    if (outcome.status !== 'approved') {
      const messages = {
        denied: t('options_connectDenied'),
        expired: t('options_connectExpired'),
        cancelled: t('options_connectCancelled'),
      } as const;
      setStatus(messages[outcome.status], 'error');
      return;
    }
    if (tabId != null) await chrome.tabs.remove(tabId).catch(() => undefined);
    const previous = await getConnectionSettings();
    const next: ConnectionSettings = {
      ...previous,
      instanceUrl,
      apiKey: outcome.apiKey,
      connectedAs: outcome.user?.name ?? '',
      // Another instance's patterns and projects do not apply to this one.
      ...(previous.instanceUrl === instanceUrl ? {} : { serverMappings: [], serverProjects: [], serverSyncedAt: 0 }),
    };
    stored = next;
    await setConnectionSettings(next);
    apiKeyEl.value = outcome.apiKey;
    apiKeyFallback.open = false;
    await syncServerPatterns(next);
    projectOptions = syncedProjectOptions();
    renderMappings();
    const catalogs = await refreshCatalogs(stored);
    const parts = [
      outcome.user ? t('options_connectedAs', { name: outcome.user.name }) : t('options_connectedNoAuth'),
      tn('options_serverPatterns', stored.serverMappings.length),
    ];
    if (catalogs.failed > 0) parts.push(tn('options_catalogsFailed', catalogs.failed));
    setStatus(parts.join(' '), catalogs.failed > 0 || serverSyncError ? 'error' : 'ok');
  } catch (err) {
    setStatus(err instanceof Error ? err.message : String(err), 'error');
  } finally {
    if (pendingConnect === controller) pendingConnect = null;
    setConnecting(false);
  }
}

refreshServerBtn.addEventListener('click', () => {
  const settings = currentInstanceSettings();
  // Before any await, so the click still counts as the user gesture.
  const permission = ensureInstanceHostPermission(settings.instanceUrl);
  void (async () => {
    await permission;
    setStatus(t('options_serverReading'));
    if (await syncServerPatterns(settings)) {
      projectOptions = syncedProjectOptions();
      renderMappings();
      setStatus(tn('options_serverPatterns', stored.serverMappings.length), 'ok');
    } else {
      setStatus(t('options_serverSyncFailed', { error: serverSyncError }), 'error');
    }
  })();
});

addToServerBtn.addEventListener('click', () => {
  const pattern = addPatternEl.value.trim();
  const projectId = addProjectEl.value ? Number(addProjectEl.value) : null;
  void (async () => {
    if (!pattern) {
      setStatus(t('options_addNeedsPattern'), 'error');
      return;
    }
    if (projectId == null) {
      setStatus(t('options_addNeedsProject'), 'error');
      return;
    }
    const label = addProjectEl.selectedOptions[0]?.textContent ?? `#${projectId}`;
    try {
      await addServerPattern(stored, projectId, {
        pattern,
        environment: addEnvironmentEl.value.trim() || null,
        branch: addBranchEl.value.trim() || null,
      });
    } catch (err) {
      setStatus(err instanceof Error ? err.message : String(err), 'error');
      return;
    }
    addPatternEl.value = '';
    addEnvironmentEl.value = '';
    addBranchEl.value = '';
    await syncServerPatterns(stored);
    await refreshCatalogs(stored);
    setStatus(t('options_added', { pattern, project: label }), 'ok');
  })();
});

addLocallyBtn.addEventListener('click', () => {
  const pattern = addPatternEl.value.trim();
  if (!pattern) {
    setStatus(t('options_addNeedsPattern'), 'error');
    return;
  }
  const projectId = addProjectEl.value ? Number(addProjectEl.value) : null;
  mappings.push({
    urlPattern: pattern,
    projectId,
    projectLabel: projectId != null ? (addProjectEl.selectedOptions[0]?.textContent ?? '') : '',
    branch: addBranchEl.value.trim(),
  });
  renderMappings();
  addPatternEl.value = '';
  setStatus(t('options_addedLocally'), 'ok');
});

testBtn.addEventListener('click', () => {
  const settings = currentInstanceSettings();
  // Before any await, so the click still counts as the user gesture.
  const permission = ensureInstanceHostPermission(settings.instanceUrl);
  void (async () => {
    setStatus(t('options_testing'));
    if (!(await permission)) {
      setStatus(t('options_accessDenied'), 'error');
      return;
    }
    const result = await testConnection(settings);
    if (!result.ok) {
      setStatus(result.error, 'error');
      return;
    }
    try {
      projectOptions = await fetchProjects(settings);
      renderMappings();
      setStatus(tn('options_connected', projectOptions.length), 'ok');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : t('options_projectsUnlisted'), 'error');
    }
  })();
});

saveBtn.addEventListener('click', () => {
  const base = currentInstanceSettings();
  // Before any await, so the click still counts as the user gesture.
  const permission = ensureInstanceHostPermission(base.instanceUrl);
  void (async () => {
    if (!base.instanceUrl) {
      setStatus(t('common_enterInstanceUrl'), 'error');
      return;
    }
    const granted = await permission;

    const valid = mappings.filter((m) => m.urlPattern.trim() && m.projectId != null);
    const incompleteCount = mappings.length - valid.length;

    const sameInstance = stored.instanceUrl === base.instanceUrl;
    const settings: ConnectionSettings = {
      ...base,
      ...(sameInstance ? {} : { serverMappings: [], serverProjects: [], serverSyncedAt: 0, connectedAs: '' }),
      projectMappings: valid.map((m) => ({
        urlPattern: m.urlPattern.trim(),
        projectId: m.projectId!,
        projectLabel: m.projectLabel,
        ...(m.branch.trim() ? { branch: m.branch.trim() } : {}),
      })),
    };
    stored = settings;
    await setConnectionSettings(settings);
    await syncServerPatterns(settings);

    const catalogs = await refreshCatalogs(stored);

    const parts = [tn('options_saved', valid.length)];
    if (incompleteCount > 0) parts.push(tn('options_skipped', incompleteCount));
    // The API key travels on every catalog fetch; over plain HTTP it travels in
    // the clear. Worth saying once, at the moment the choice is made — not a
    // reason to refuse a local instance on `http://localhost`.
    if (/^http:\/\//i.test(settings.instanceUrl) && settings.apiKey) {
      parts.push(t('options_plainHttp'));
    }
    // Without the host permission the catalog can still be fetched from this
    // page if the instance happens to allow the origin, but the background
    // refresh never can — so the catalog would silently stop updating.
    if (!granted) parts.push(t('options_refreshDenied'));
    if (catalogs.projects > 0) {
      parts.push(
        t('options_cached', {
          functions: tn('options_functionCount', catalogs.functions),
          projects: tn('options_projectCount', catalogs.projects),
        }),
      );
    }
    if (catalogs.failed > 0) parts.push(tn('options_catalogsFailed', catalogs.failed));
    setStatus(parts.join(' '), catalogs.failed > 0 ? 'error' : 'ok');
  })();
});

/**
 * Gives back the host permission for an instance we are no longer connected to.
 *
 * Disconnecting used to clear the settings and the cached catalogs but leave the
 * granted origin in place indefinitely — a standing grant for a host the
 * extension has no further business with, and one the user would reasonably
 * assume "Disconnect" had withdrawn. Never touches anything but that one origin:
 * a recording's own granted site is a separate grant with its own lifetime.
 */
async function revokeInstanceHostPermission(instanceUrl: string): Promise<void> {
  if (!instanceUrl.trim()) return;
  let origin: string;
  try {
    origin = new URL(instanceUrl).origin;
  } catch {
    return;
  }
  await chrome.permissions.remove({ origins: [`${origin}/*`] }).catch(() => undefined);
}

disconnectBtn.addEventListener('click', () => {
  void (async () => {
    const previousUrl = instanceUrlEl.value;
    pendingConnect?.abort();
    await clearConnectionSettings();
    stored = await getConnectionSettings();
    serverSyncError = '';
    await pruneCachedCatalogs([]);
    await revokeInstanceHostPermission(previousUrl);
    instanceUrlEl.value = '';
    apiKeyEl.value = '';
    projectOptions = [];
    mappings = [];
    renderMappings();
    renderServerMappings();
    renderConnectedAs();
    setStatus(t('options_disconnected'), 'ok');
  })();
});

/**
 * The Language setting: follow the browser, or one of the shipped languages,
 * each named in itself. The background worker stores the choice with its
 * catalog; this page then reads it again and redraws in the new language.
 */
function renderLanguageSelect(): void {
  const follow = document.createElement('option');
  follow.value = '';
  follow.textContent = t('options_languageBrowser', { language: languageName(browserCatalogLanguage()) });
  const options = LANGUAGES.map((code) => {
    const option = document.createElement('option');
    option.value = code;
    option.lang = languageTag(code);
    option.textContent = languageName(code);
    return option;
  });
  languageSelect.replaceChildren(follow, ...options);
  languageSelect.value = chosenLanguage() ?? '';
  renderDraftNote();
}

/** Under the setting, in a draft language: the translation is a draft, and where to suggest a correction. */
function renderDraftNote(): void {
  const shown = chosenLanguage() ?? browserCatalogLanguage();
  draftNote.hidden = !isDraftLanguage(shown);
  if (draftNote.hidden) {
    draftNote.replaceChildren();
    return;
  }
  const link = document.createElement('a');
  link.href = TRANSLATION_ISSUE_URL;
  link.target = '_blank';
  link.rel = 'noopener noreferrer';
  link.textContent = t('options_draftNoteLink');
  draftNote.replaceChildren(...tNodes('options_draftNote', { link }));
}

languageSelect.addEventListener('change', () => {
  const code = (languageSelect.value || null) as Language | null;
  void (async () => {
    let answer: { ok: boolean; error?: string } | undefined;
    try {
      answer = (await chrome.runtime.sendMessage({ type: 'piwi-set-language', code })) as typeof answer;
    } catch (err) {
      answer = { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
    await initI18n();
    localizeDocument();
    renderLanguageSelect();
    renderMappings();
    renderServerMappings();
    renderConnectedAs();
    if (answer?.ok) setStatus(t('options_languageSaved'), 'ok');
    else setStatus(t('options_languageFailed', { error: answer?.error ?? t('common_workerNoAnswer') }), 'error');
  })();
});

// Send to editor: the pairing lives in extension storage; the editor's origin is granted inside the Pair click.
const editorAddressEl = document.getElementById('editor-address') as HTMLInputElement;
const editorPairBtn = document.getElementById('editor-pair') as HTMLButtonElement;
const editorUnpairBtn = document.getElementById('editor-unpair') as HTMLButtonElement;
const editorStatusEl = document.getElementById('editor-status') as HTMLElement;

async function renderEditorPairing(): Promise<void> {
  const pairing = await getEditorPairing();
  editorStatusEl.textContent = pairing ? t('options_editorPaired', { url: pairing.url }) : '';
  editorUnpairBtn.hidden = !pairing;
}

editorPairBtn.addEventListener('click', () => {
  const pairing = parsePairing(editorAddressEl.value);
  if (!pairing) {
    editorStatusEl.textContent = t('options_editorInvalid');
    return;
  }
  // Requested before anything is awaited: the permission prompt needs the live click.
  const granted = chrome.permissions.request({ origins: [editorOriginPattern(pairing)] }).catch(() => false);
  void (async () => {
    if (!(await granted)) {
      editorStatusEl.textContent = t('options_editorPermission');
      return;
    }
    await setEditorPairing(pairing);
    editorAddressEl.value = '';
    await renderEditorPairing();
  })();
});

editorUnpairBtn.addEventListener('click', () => {
  void (async () => {
    const pairing = await getEditorPairing();
    await setEditorPairing(null);
    if (pairing) await chrome.permissions.remove({ origins: [editorOriginPattern(pairing)] }).catch(() => false);
    await renderEditorPairing();
  })();
});

renderLanguageSelect();
void loadInitial();
void renderEditorPairing();
