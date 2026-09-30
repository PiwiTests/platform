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
  testDesktop,
  startDesktopPairing,
  pollDesktopPairing,
  type ProjectOption,
} from '../shared/piwi-client.js';
import {
  DESKTOP_DEFAULT_URL,
  clearDesktopSettings,
  desktopOrigin,
  getDesktopSettings,
  setDesktopSettings,
} from '../shared/desktop-settings.js';
import { normalizePathPrefix, parsePathPrefix } from '@piwitests/core/page-key';
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
  type MessageKey,
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
const addPrefixEl = document.getElementById('add-prefix') as HTMLInputElement;
const addTestPrefixEl = document.getElementById('add-test-prefix') as HTMLInputElement;
const addNoteEl = document.getElementById('add-note') as HTMLElement;
const addToServerBtn = document.getElementById('add-to-server') as HTMLButtonElement;
const addLocallyBtn = document.getElementById('add-locally') as HTMLButtonElement;
const apiKeyEl = document.getElementById('api-key') as HTMLInputElement;
const mappingsEl = document.getElementById('mappings')!;
const addMappingBtn = document.getElementById('add-mapping') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const mappingsStatusEl = document.getElementById('mappings-status')!;
const languageStatusEl = document.getElementById('language-status')!;
const instancePill = document.getElementById('instance-pill') as HTMLElement;
const sitesConnectFirst = document.getElementById('sites-connect-first') as HTMLElement;
const sitesBody = document.getElementById('sites-body') as HTMLElement;
const mappingHead = document.getElementById('mapping-head') as HTMLElement;
const apiKeySaveBtn = document.getElementById('api-key-save') as HTMLButtonElement;
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
  /** The part of the site's path the tests never saw (`/app`); empty for none. */
  pathPrefix: string;
  /** The part of the path the tests ran the pages under and the site does not; empty for none. */
  testPathPrefix: string;
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

type StatusKind = 'ok' | 'error' | '';

function writeStatus(el: HTMLElement, text: string, kind: StatusKind): void {
  el.textContent = text;
  el.className = kind;
}

/** The Connect to Piwi card's status line. */
function setStatus(text: string, kind: StatusKind = ''): void {
  writeStatus(statusEl, text, kind);
}

/** The Project mappings card's status line. */
function setMappingsStatus(text: string, kind: StatusKind = ''): void {
  writeStatus(mappingsStatusEl, text, kind);
}

/** A card's badge: on (Connected, Paired) or off. */
function setPill(pill: HTMLElement, on: boolean, onKey: MessageKey, offKey: MessageKey): void {
  pill.classList.toggle('on', on);
  pill.textContent = t(on ? onKey : offKey);
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
  mappingHead.hidden = mappings.length === 0;

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
    row.className = 'mapping-row mapping-grid';

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

    const prefixInput = pathPrefixInput(mapping.pathPrefix, 'site');
    prefixInput.addEventListener('input', () => {
      mappings[index]!.pathPrefix = prefixInput.value;
    });
    const testPrefixInput = pathPrefixInput(mapping.testPathPrefix, 'tests');
    testPrefixInput.addEventListener('input', () => {
      mappings[index]!.testPathPrefix = testPrefixInput.value;
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

    row.append(patternInput, projectSelect, branchInput, prefixInput, testPrefixInput, removeBtn);
    mappingsEl.appendChild(row);
  });
}

/** Why `value` is refused as a path prefix; empty when it is accepted (an empty value is no prefix). */
function pathPrefixError(value: string): string {
  return parsePathPrefix(value).ok ? '' : t('options_pathPrefixInvalid', { prefix: value.trim() });
}

/** The first refusal among a line's or the form's two prefixes; empty when both are accepted. */
function prefixesError(pathPrefix: string, testPathPrefix: string): string {
  return pathPrefixError(pathPrefix) || pathPrefixError(testPathPrefix);
}

/** `{ pathPrefix, testPathPrefix }` for a stored mapping, normalized, each only when set. */
function pathPrefixFields(
  pathPrefix: string,
  testPathPrefix: string,
): { pathPrefix?: string; testPathPrefix?: string } {
  const site = normalizePathPrefix(pathPrefix);
  const tests = normalizePathPrefix(testPathPrefix);
  return { ...(site ? { pathPrefix: site } : {}), ...(tests ? { testPathPrefix: tests } : {}) };
}

/** Which prefix a field holds: the site's (`pathPrefix`) or the tests' (`testPathPrefix`). */
type PrefixKind = 'site' | 'tests';

/** Marks a path prefix field invalid, with the reason as its tooltip, while its value is refused. */
function watchPathPrefix(input: HTMLInputElement, kind: PrefixKind): void {
  const check = () => {
    const error = pathPrefixError(input.value);
    input.title = error || (kind === 'site' ? t('options_pathPrefixTitle') : t('options_testPathPrefixTitle'));
    input.toggleAttribute('aria-invalid', error !== '');
  };
  check();
  input.addEventListener('input', check);
}

/** A path prefix field of a line. */
function pathPrefixInput(value: string, kind: PrefixKind): HTMLInputElement {
  const input = document.createElement('input');
  input.type = 'text';
  input.className = 'mapping-branch mapping-prefix';
  input.placeholder = kind === 'site' ? t('options_pathPrefixPlaceholder') : t('options_testPathPrefixPlaceholder');
  input.setAttribute('aria-label', kind === 'site' ? t('options_pathPrefix') : t('options_testPathPrefix'));
  input.value = value;
  watchPathPrefix(input, kind);
  return input;
}

watchPathPrefix(addPrefixEl, 'site');
watchPathPrefix(addTestPrefixEl, 'tests');

addMappingBtn.addEventListener('click', () => {
  mappings.push({ urlPattern: '', projectId: null, projectLabel: '', branch: '', pathPrefix: '', testPathPrefix: '' });
  renderMappings();
});

/**
 * What the Connect to Piwi card says of the connection: its badge, "Connected
 * as …" once a sync has worked, Disconnect while an instance is kept; and the
 * Project mappings card, whose patterns need that instance's projects.
 */
function renderInstanceState(): void {
  const kept = stored.instanceUrl.trim() !== '';
  const synced = kept && stored.serverSyncedAt > 0;
  setPill(instancePill, kept, 'options_stateConnected', 'options_stateNotConnected');
  // Once connected, Connect is no longer the next thing to do.
  connectBtn.classList.toggle('primary', !kept);
  disconnectBtn.hidden = !kept;
  connectedAsEl.hidden = !synced;
  connectedAsEl.textContent = !synced
    ? ''
    : stored.connectedAs
      ? t('options_connectedAs', { name: stored.connectedAs })
      : t('options_connectedNoAuth');
  sitesConnectFirst.hidden = kept;
  sitesBody.hidden = !kept;
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
    meta.textContent = [
      mapping.projectLabel,
      mapping.environment,
      mapping.branch,
      mapping.pathPrefix ? t('options_serverPathPrefix', { prefix: mapping.pathPrefix }) : '',
      mapping.testPathPrefix ? t('options_serverTestPathPrefix', { prefix: mapping.testPathPrefix }) : '',
    ]
      .filter(Boolean)
      .join(' · ');
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
    renderInstanceState();
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
    pathPrefix: m.pathPrefix ?? '',
    testPathPrefix: m.testPathPrefix ?? '',
  }));
  projectOptions = syncedProjectOptions();
  renderMappings();
  renderServerMappings();
  renderInstanceState();
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
      // Instance unreachable at load time: the lines keep the projects the last sync read.
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
  (addSiteEl as HTMLDetailsElement).open = true;
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
  const settings = stored;
  // Before any await, so the click still counts as the user gesture.
  const permission = ensureInstanceHostPermission(settings.instanceUrl);
  void (async () => {
    await permission;
    setMappingsStatus(t('options_serverReading'));
    if (await syncServerPatterns(settings)) {
      projectOptions = syncedProjectOptions();
      renderMappings();
      setMappingsStatus(tn('options_serverPatterns', stored.serverMappings.length), 'ok');
    } else {
      setMappingsStatus(t('options_serverSyncFailed', { error: serverSyncError }), 'error');
    }
  })();
});

addToServerBtn.addEventListener('click', () => {
  const pattern = addPatternEl.value.trim();
  const projectId = addProjectEl.value ? Number(addProjectEl.value) : null;
  void (async () => {
    if (!pattern) {
      setMappingsStatus(t('options_addNeedsPattern'), 'error');
      return;
    }
    if (projectId == null) {
      setMappingsStatus(t('options_addNeedsProject'), 'error');
      return;
    }
    const prefixError = prefixesError(addPrefixEl.value, addTestPrefixEl.value);
    if (prefixError) {
      setMappingsStatus(prefixError, 'error');
      return;
    }
    const label = addProjectEl.selectedOptions[0]?.textContent ?? `#${projectId}`;
    try {
      await addServerPattern(stored, projectId, {
        pattern,
        environment: addEnvironmentEl.value.trim() || null,
        branch: addBranchEl.value.trim() || null,
        pathPrefix: normalizePathPrefix(addPrefixEl.value),
        testPathPrefix: normalizePathPrefix(addTestPrefixEl.value),
      });
    } catch (err) {
      setMappingsStatus(err instanceof Error ? err.message : String(err), 'error');
      return;
    }
    addPatternEl.value = '';
    addEnvironmentEl.value = '';
    addBranchEl.value = '';
    addPrefixEl.value = '';
    addTestPrefixEl.value = '';
    await syncServerPatterns(stored);
    await refreshCatalogs(stored);
    setMappingsStatus(t('options_added', { pattern, project: label }), 'ok');
  })();
});

addLocallyBtn.addEventListener('click', () => {
  const pattern = addPatternEl.value.trim();
  if (!pattern) {
    setMappingsStatus(t('options_addNeedsPattern'), 'error');
    return;
  }
  const prefixError = prefixesError(addPrefixEl.value, addTestPrefixEl.value);
  if (prefixError) {
    setMappingsStatus(prefixError, 'error');
    return;
  }
  const projectId = addProjectEl.value ? Number(addProjectEl.value) : null;
  mappings.push({
    urlPattern: pattern,
    projectId,
    projectLabel: projectId != null ? (addProjectEl.selectedOptions[0]?.textContent ?? '') : '',
    branch: addBranchEl.value.trim(),
    pathPrefix: normalizePathPrefix(addPrefixEl.value) ?? '',
    testPathPrefix: normalizePathPrefix(addTestPrefixEl.value) ?? '',
  });
  renderMappings();
  addPatternEl.value = '';
  addPrefixEl.value = '';
  addTestPrefixEl.value = '';
  setMappingsStatus(t('options_addedLocally'), 'ok');
});

/**
 * Use an API key instead: checks the address and the key typed against the
 * instance, keeps them, then reads its patterns and catalogs as Connect does.
 */
apiKeySaveBtn.addEventListener('click', () => {
  const typed = { instanceUrl: instanceUrlEl.value.trim(), apiKey: apiKeyEl.value.trim() };
  // Before any await, so the click still counts as the user gesture.
  const permission = ensureInstanceHostPermission(typed.instanceUrl);
  void (async () => {
    if (!typed.instanceUrl) {
      setStatus(t('common_enterInstanceUrl'), 'error');
      return;
    }
    setStatus(t('options_testing'));
    if (!(await permission)) {
      setStatus(t('options_accessDenied'), 'error');
      return;
    }
    const sameInstance = stored.instanceUrl === typed.instanceUrl;
    const settings: ConnectionSettings = {
      ...stored,
      ...typed,
      ...(sameInstance ? {} : { serverMappings: [], serverProjects: [], serverSyncedAt: 0, connectedAs: '' }),
    };
    const result = await testConnection(settings);
    if (!result.ok) {
      setStatus(result.error, 'error');
      return;
    }
    stored = settings;
    await setConnectionSettings(settings);
    await syncServerPatterns(settings);
    try {
      projectOptions = await fetchProjects(settings);
    } catch {
      projectOptions = syncedProjectOptions();
    }
    renderMappings();
    const catalogs = await refreshCatalogs(stored);
    const parts = [tn('options_connected', projectOptions.length)];
    // The API key travels on every catalog fetch; over plain HTTP it travels in
    // the clear. Worth saying once, at the moment the choice is made — not a
    // reason to refuse a local instance on `http://localhost`.
    if (/^http:\/\//i.test(settings.instanceUrl) && settings.apiKey) parts.push(t('options_plainHttp'));
    if (catalogs.failed > 0) parts.push(tn('options_catalogsFailed', catalogs.failed));
    setStatus(parts.join(' '), catalogs.failed > 0 ? 'error' : 'ok');
  })();
});

/** Save keeps the lines of this browser, then fetches the catalogs of the projects they map. */
saveBtn.addEventListener('click', () => {
  // Before any await, so the click still counts as the user gesture.
  const permission = ensureInstanceHostPermission(stored.instanceUrl);
  void (async () => {
    if (!stored.instanceUrl.trim()) {
      setMappingsStatus(t('common_enterInstanceUrl'), 'error');
      return;
    }
    const granted = await permission;

    const badPrefix = mappings.find((m) => prefixesError(m.pathPrefix, m.testPathPrefix));
    if (badPrefix) {
      setMappingsStatus(prefixesError(badPrefix.pathPrefix, badPrefix.testPathPrefix), 'error');
      return;
    }
    const valid = mappings.filter((m) => m.urlPattern.trim() && m.projectId != null);
    const incompleteCount = mappings.length - valid.length;

    const settings: ConnectionSettings = {
      ...(await getConnectionSettings()),
      projectMappings: valid.map((m) => ({
        urlPattern: m.urlPattern.trim(),
        projectId: m.projectId!,
        projectLabel: m.projectLabel,
        ...(m.branch.trim() ? { branch: m.branch.trim() } : {}),
        ...pathPrefixFields(m.pathPrefix, m.testPathPrefix),
      })),
    };
    stored = settings;
    await setConnectionSettings(settings);
    await syncServerPatterns(settings);

    const catalogs = await refreshCatalogs(stored);

    const parts = [tn('options_saved', valid.length)];
    if (incompleteCount > 0) parts.push(tn('options_skipped', incompleteCount));
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
    setMappingsStatus(parts.join(' '), catalogs.failed > 0 ? 'error' : 'ok');
  })();
});

/**
 * Gives back the host permission for an instance we are no longer connected to,
 * so "Disconnect" leaves no standing grant for a host the extension has no
 * further business with. Never touches anything but that one origin: a
 * recording's own granted site is a separate grant with its own lifetime.
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
    const previousUrl = stored.instanceUrl;
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
    renderInstanceState();
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
    renderInstanceState();
    renderEditorPill();
    void renderDesktopState();
    if (answer?.ok) writeStatus(languageStatusEl, t('options_languageSaved'), 'ok');
    else {
      const error = answer?.error ?? t('common_workerNoAnswer');
      writeStatus(languageStatusEl, t('options_languageFailed', { error }), 'error');
    }
  })();
});

// Send to editor: the pairing lives in extension storage; the editor's origin is granted inside the Pair click.
const editorAddressEl = document.getElementById('editor-address') as HTMLInputElement;
const editorPairBtn = document.getElementById('editor-pair') as HTMLButtonElement;
const editorUnpairBtn = document.getElementById('editor-unpair') as HTMLButtonElement;
const editorStatusEl = document.getElementById('editor-status') as HTMLElement;
const editorPill = document.getElementById('editor-pill') as HTMLElement;
let editorPaired = false;

function renderEditorPill(): void {
  setPill(editorPill, editorPaired, 'options_statePaired', 'options_stateNotPaired');
}

async function renderEditorPairing(): Promise<void> {
  const pairing = await getEditorPairing();
  editorPaired = !!pairing;
  writeStatus(editorStatusEl, pairing ? t('options_editorPaired', { url: pairing.url }) : '', pairing ? 'ok' : '');
  editorUnpairBtn.hidden = !pairing;
  editorPairBtn.classList.toggle('primary', !pairing);
  renderEditorPill();
}

editorPairBtn.addEventListener('click', () => {
  const pairing = parsePairing(editorAddressEl.value);
  if (!pairing) {
    writeStatus(editorStatusEl, t('options_editorInvalid'), 'error');
    return;
  }
  // Requested before anything is awaited: the permission prompt needs the live click.
  const granted = chrome.permissions.request({ origins: [editorOriginPattern(pairing)] }).catch(() => false);
  void (async () => {
    if (!(await granted)) {
      writeStatus(editorStatusEl, t('options_editorPermission'), 'error');
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

// ---------------------------------------------------------------------------
// The desktop app, for Run with Playwright

const desktopUrlEl = document.getElementById('desktop-url') as HTMLInputElement;
const desktopTokenEl = document.getElementById('desktop-token') as HTMLInputElement;
const desktopStatusEl = document.getElementById('desktop-status')!;
const desktopPill = document.getElementById('desktop-pill') as HTMLElement;
const desktopPairBtn = document.getElementById('desktop-pair') as HTMLButtonElement;
const desktopPairPanel = document.getElementById('desktop-pair-panel') as HTMLElement;
const desktopCodeLine = document.getElementById('desktop-code-line')!;
const desktopForgetBtn = document.getElementById('desktop-forget') as HTMLButtonElement;
const desktopManual = document.getElementById('desktop-manual') as HTMLDetailsElement;
/** Set while a pairing waits for the Allow in the app's window; aborting it stops the wait. */
let pendingDesktopPairing: AbortController | null = null;

function setDesktopStatus(text: string, kind: StatusKind = ''): void {
  writeStatus(desktopStatusEl, text, kind);
}

/** The card as the stored pairing says: its badge, its address, and Unpair. */
async function renderDesktopState(): Promise<void> {
  const desktop = await getDesktopSettings();
  setPill(desktopPill, !!desktop, 'options_statePaired', 'options_stateNotPaired');
  desktopPairBtn.classList.toggle('primary', !desktop);
  desktopForgetBtn.hidden = !desktop;
  if (desktop && !desktopUrlEl.value) desktopUrlEl.value = desktop.url;
  if (!desktop && !desktopUrlEl.value) desktopUrlEl.value = DESKTOP_DEFAULT_URL;
}

/** Keeps a pairing that works: checked against the app first, then stored and said. */
async function keepDesktopPairing(url: string, token: string): Promise<void> {
  const check = await testDesktop({ url, token });
  if (!check.ok) {
    setDesktopStatus(check.error, 'error');
    return;
  }
  await setDesktopSettings({ url, token });
  desktopUrlEl.value = url;
  desktopTokenEl.value = '';
  desktopManual.open = false;
  setDesktopStatus(t('options_desktopPairedAt', { url }), 'ok');
  await renderDesktopState();
}

function setDesktopPairing(active: boolean): void {
  desktopPairBtn.disabled = active;
  desktopPairPanel.hidden = !active;
  if (!active) desktopCodeLine.replaceChildren();
}

/**
 * Pair: the app's window shows the request with a code this card shows too;
 * the developer's Allow there hands this extension the app's token on the next
 * poll. The one loopback origin is asked for first, inside the click.
 */
desktopPairBtn.addEventListener('click', () => {
  const url = desktopOrigin(desktopUrlEl.value);
  if (!url) {
    setDesktopStatus(t('options_desktopNotLoopback'), 'error');
    return;
  }
  const granted = chrome.permissions.request({ origins: [`${url}/*`] }).catch(() => false);
  void (async () => {
    if (!(await granted)) {
      setDesktopStatus(t('options_desktopNeedsAccess'), 'error');
      return;
    }
    pendingDesktopPairing?.abort();
    const controller = new AbortController();
    pendingDesktopPairing = controller;
    setDesktopStatus(t('options_desktopPairStarting'));
    try {
      const start = await startDesktopPairing(url, describeClient(navigator.userAgent));
      const code = document.createElement('code');
      code.textContent = start.code;
      desktopCodeLine.replaceChildren(...tNodes('options_desktopPairCode', { code }));
      setDesktopPairing(true);
      setDesktopStatus(start.windowOpen ? '' : t('options_desktopPairNoWindow'));
      const outcome = await waitForApproval({
        poll: () => pollDesktopPairing(url, start),
        interval: start.interval,
        expiresIn: start.expiresIn,
        sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
        now: () => Date.now(),
        signal: controller.signal,
      });
      setDesktopPairing(false);
      if (outcome.status === 'approved') {
        await keepDesktopPairing(url, outcome.apiKey);
        return;
      }
      const messages = {
        denied: t('options_desktopPairDenied'),
        expired: t('options_desktopPairExpired'),
        cancelled: t('options_desktopPairCancelled'),
      } as const;
      setDesktopStatus(messages[outcome.status], 'error');
    } catch (err) {
      setDesktopStatus(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      if (pendingDesktopPairing === controller) pendingDesktopPairing = null;
      setDesktopPairing(false);
    }
  })();
});

document.getElementById('desktop-pair-cancel')!.addEventListener('click', () => {
  pendingDesktopPairing?.abort();
});

/** Pair by hand: the address and the token pasted from the app's Setup page. */
document.getElementById('desktop-save')!.addEventListener('click', () => {
  const url = desktopOrigin(desktopUrlEl.value);
  const token = desktopTokenEl.value.trim();
  if (!url) {
    setDesktopStatus(t('options_desktopNotLoopback'), 'error');
    return;
  }
  if (!token) {
    setDesktopStatus(t('options_desktopNeedsToken'), 'error');
    return;
  }
  // Asked first, while the click still counts as a user gesture; the one loopback origin only.
  const granted = chrome.permissions.request({ origins: [`${url}/*`] }).catch(() => false);
  void (async () => {
    if (!(await granted)) {
      setDesktopStatus(t('options_desktopNeedsAccess'), 'error');
      return;
    }
    setDesktopStatus(t('options_testing'));
    await keepDesktopPairing(url, token);
  })();
});

desktopForgetBtn.addEventListener('click', () => {
  void (async () => {
    const desktop = await getDesktopSettings();
    await clearDesktopSettings();
    if (desktop) await chrome.permissions.remove({ origins: [`${desktop.url}/*`] }).catch(() => false);
    desktopTokenEl.value = '';
    setDesktopStatus(t('options_desktopForgotten'), 'ok');
    await renderDesktopState();
  })();
});

void getDesktopSettings().then((desktop) => {
  if (desktop) setDesktopStatus(t('options_desktopPairedAt', { url: desktop.url }), 'ok');
  return renderDesktopState();
});

renderLanguageSelect();
void loadInitial();
void renderEditorPairing();
