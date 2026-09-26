import {
  getConnectionSettings,
  setConnectionSettings,
  clearConnectionSettings,
  type ConnectionSettings,
} from '../shared/connection-settings.js';
import { testConnection, fetchProjects, fetchCatalog, type ProjectOption } from '../shared/piwi-client.js';
import { setCachedCatalog, pruneCachedCatalogs } from '../shared/catalog-cache.js';

const instanceUrlEl = document.getElementById('instance-url') as HTMLInputElement;
const apiKeyEl = document.getElementById('api-key') as HTMLInputElement;
const mappingsEl = document.getElementById('mappings')!;
const addMappingBtn = document.getElementById('add-mapping') as HTMLButtonElement;
const statusEl = document.getElementById('status')!;
const testBtn = document.getElementById('test-connection') as HTMLButtonElement;
const saveBtn = document.getElementById('save') as HTMLButtonElement;
const disconnectBtn = document.getElementById('disconnect') as HTMLButtonElement;

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

function setStatus(text: string, kind: 'ok' | 'error' | '' = ''): void {
  statusEl.textContent = text;
  statusEl.className = kind;
}

function currentInstanceSettings(): ConnectionSettings {
  return { instanceUrl: instanceUrlEl.value.trim(), apiKey: apiKeyEl.value.trim(), projectMappings: [] };
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
    empty.textContent = 'No mappings yet — add one below.';
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
    patternInput.placeholder = 'https://shop.example.com/**';
    patternInput.setAttribute('aria-label', 'URL pattern');
    patternInput.value = mapping.urlPattern;
    patternInput.addEventListener('input', () => {
      mappings[index]!.urlPattern = patternInput.value;
    });

    const projectSelect = document.createElement('select');
    projectSelect.className = 'mapping-project';
    projectSelect.setAttribute('aria-label', 'Project');
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = projectOptions.length === 0 ? 'Test connection first' : 'Select a project…';
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
    branchInput.placeholder = 'default branch';
    branchInput.title = 'The branch deployed at these URLs: Tested elements shows what its tests reach';
    branchInput.setAttribute('aria-label', 'Branch deployed there');
    branchInput.value = mapping.branch;
    branchInput.addEventListener('input', () => {
      mappings[index]!.branch = branchInput.value;
    });

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'remove-mapping';
    removeBtn.setAttribute('aria-label', 'Remove mapping');
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      mappings.splice(index, 1);
      renderMappings();
    });

    row.append(patternInput, projectSelect, branchInput, removeBtn);
    mappingsEl.appendChild(row);
  });
}

addMappingBtn.addEventListener('click', () => {
  mappings.push({ urlPattern: '', projectId: null, projectLabel: '', branch: '' });
  renderMappings();
});

async function loadInitial(): Promise<void> {
  const settings = await getConnectionSettings();
  instanceUrlEl.value = settings.instanceUrl;
  apiKeyEl.value = settings.apiKey;
  mappings = settings.projectMappings.map((m) => ({
    urlPattern: m.urlPattern,
    projectId: m.projectId,
    projectLabel: m.projectLabel,
    branch: m.branch ?? '',
  }));
  renderMappings();

  if (settings.instanceUrl) {
    try {
      projectOptions = await fetchProjects(settings);
      renderMappings();
    } catch {
      // Instance unreachable at load time — leave placeholders; "Test connection" surfaces the error.
    }
  }
}

testBtn.addEventListener('click', () => {
  const settings = currentInstanceSettings();
  // Before any await, so the click still counts as the user gesture.
  const permission = ensureInstanceHostPermission(settings.instanceUrl);
  void (async () => {
    setStatus('Testing…');
    if (!(await permission)) {
      setStatus('Access to that instance was denied — grant it to let Piwi Picker read your catalog.', 'error');
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
      setStatus(`Connected — ${projectOptions.length} project${projectOptions.length === 1 ? '' : 's'} found.`, 'ok');
    } catch (err) {
      setStatus(err instanceof Error ? err.message : 'Connected, but failed to list projects.', 'error');
    }
  })();
});

saveBtn.addEventListener('click', () => {
  const base = currentInstanceSettings();
  // Before any await, so the click still counts as the user gesture.
  const permission = ensureInstanceHostPermission(base.instanceUrl);
  void (async () => {
    if (!base.instanceUrl) {
      setStatus('Enter an instance URL first.', 'error');
      return;
    }
    const granted = await permission;

    const valid = mappings.filter((m) => m.urlPattern.trim() && m.projectId != null);
    const incompleteCount = mappings.length - valid.length;

    const settings: ConnectionSettings = {
      ...base,
      projectMappings: valid.map((m) => ({
        urlPattern: m.urlPattern.trim(),
        projectId: m.projectId!,
        projectLabel: m.projectLabel,
        ...(m.branch.trim() ? { branch: m.branch.trim() } : {}),
      })),
    };
    await setConnectionSettings(settings);

    const distinctProjectIds = [...new Set(valid.map((m) => m.projectId!))];
    let cachedFunctionCount = 0;
    let failedFetchCount = 0;
    for (const projectId of distinctProjectIds) {
      try {
        const catalog = await fetchCatalog(settings, projectId);
        await setCachedCatalog(projectId, catalog);
        cachedFunctionCount += catalog.length;
      } catch {
        failedFetchCount++;
      }
    }
    await pruneCachedCatalogs(distinctProjectIds);

    const parts = [`Saved ${valid.length} mapping${valid.length === 1 ? '' : 's'}`];
    if (incompleteCount > 0) parts.push(`${incompleteCount} incomplete row${incompleteCount === 1 ? '' : 's'} skipped`);
    // The API key travels on every catalog fetch; over plain HTTP it travels in
    // the clear. Worth saying once, at the moment the choice is made — not a
    // reason to refuse a local instance on `http://localhost`.
    if (/^http:\/\//i.test(settings.instanceUrl) && settings.apiKey) {
      parts.push('this instance is plain HTTP, so the API key is sent unencrypted');
    }
    // Without the host permission the catalog can still be fetched from this
    // page if the instance happens to allow the origin, but the background
    // refresh never can — so the catalog would silently stop updating.
    if (!granted) parts.push('access to the instance was denied, so the catalog will not refresh on its own');
    if (distinctProjectIds.length > 0) {
      parts.push(
        `cached ${cachedFunctionCount} function${cachedFunctionCount === 1 ? '' : 's'} across ${distinctProjectIds.length} project${distinctProjectIds.length === 1 ? '' : 's'}`,
      );
    }
    if (failedFetchCount > 0)
      parts.push(`${failedFetchCount} catalog fetch${failedFetchCount === 1 ? '' : 'es'} failed`);
    setStatus(`${parts.join(' — ')}.`, failedFetchCount > 0 ? 'error' : 'ok');
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
    await clearConnectionSettings();
    await pruneCachedCatalogs([]);
    await revokeInstanceHostPermission(previousUrl);
    instanceUrlEl.value = '';
    apiKeyEl.value = '';
    projectOptions = [];
    mappings = [];
    renderMappings();
    setStatus('Disconnected.', 'ok');
  })();
});

void loadInitial();
