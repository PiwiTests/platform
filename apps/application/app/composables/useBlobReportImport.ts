/**
 * Drives the blob-report import on the client.
 *
 * The browser owns the batching: one archive per request, uploaded in sequence,
 * so a year of history never becomes one enormous body the server has to buffer.
 * Everything that can be judged without spending an upload is judged first —
 * the size limit is fetched before any file is read, and archives already in the
 * project are recognised from their digest — so the failure modes the user
 * actually hits are reported before the bytes move, not after.
 */

import { Sha256, sha256Blob } from '#shared/utils/sha256';
import type {
  ImportCheckResponse,
  ImportCheckResult,
  ImportCheckStatus,
  ImportRunResponse,
} from '#shared/import.types';

export type ImportFileState =
  | 'hashing'
  | 'checking'
  /** Cleared the pre-flight; waiting for the user to start the import. */
  | 'ready'
  | 'uploading'
  | 'imported'
  | 'duplicate'
  | 'too-large'
  | 'invalid'
  | 'failed';

export interface ImportFileEntry {
  id: number;
  /** The picked browser file, uploaded over HTTP. Absent for a desktop path entry. */
  file?: File;
  /**
   * Absolute path on this machine, set only in the desktop shell: the server
   * reads the archive from disk instead of the browser uploading its bytes.
   */
  path?: string;
  name: string;
  size: number;
  state: ImportFileState;
  /** Why this file is not `ready`, or what went wrong during upload. */
  message?: string;
  /** Fraction 0–1 of the current phase, while `hashing` or `uploading`. */
  progress: number;
  hash?: string;
  /**
   * Identity of the selection this file arrived in, sent with the upload so
   * traces chosen together land in one run. Fixed when the file is added, not
   * when it is uploaded, so retrying a failure rejoins the run its siblings
   * went to instead of starting a second one.
   */
  group?: string;
  result?: ImportRunResponse;
}

/** Aggregate progress across a running import, for the batch counter. */
export interface ImportBatchProgress {
  /** Archives already resolved this run — imported, duplicate or failed. */
  done: number;
  /** Archives this run set out to upload. */
  total: number;
}

/** States that still consume an upload when the user starts the import. */
const UPLOADABLE: ImportFileState[] = ['ready', 'failed'];

/** Map a pre-flight verdict onto the entry state it produces. */
const STATE_BY_VERDICT: Record<ImportCheckStatus, ImportFileState> = {
  ok: 'ready',
  duplicate: 'duplicate',
  'too-large': 'too-large',
  invalid: 'invalid',
};

export function useBlobReportImport(projectName: Ref<string | undefined>) {
  /**
   * `$fetch` applies the app's base URL for us; a raw `XMLHttpRequest` does
   * not. The demo is served under a sub-path, and its service worker only
   * intercepts requests beneath it — an unprefixed `/api/...` would sail past
   * it to the static host.
   */
  const importUrl = withAppBase('/api/test-runs/import');

  const entries = ref<ImportFileEntry[]>([]);
  const maxBytes = ref<number | null>(null);
  const limitError = ref<string | null>(null);
  const importing = ref(false);

  let nextId = 1;

  const readyCount = computed(() => entries.value.filter((e) => UPLOADABLE.includes(e.state)).length);
  const importedCount = computed(() => entries.value.filter((e) => e.state === 'imported').length);
  const busy = computed(() => entries.value.some((e) => e.state === 'hashing' || e.state === 'checking'));

  /**
   * Aggregate progress for the batch counter. A long import is a sequence of
   * per-row states; without a running total the page gives no sense of how much
   * of the batch is left.
   */
  const batch = ref<ImportBatchProgress>({ done: 0, total: 0 });

  /**
   * Fetch the server's size limit before any file is read, so an oversized
   * archive is rejected without hashing or uploading it. Doubles as an early
   * permission check: a user who may not import learns it now.
   */
  async function loadLimit(): Promise<void> {
    if (!projectName.value) return;
    try {
      const response = await $fetch<ImportCheckResponse>('/api/test-runs/import/check', {
        method: 'POST',
        body: { projectName: projectName.value, files: [] },
      });
      maxBytes.value = response.maxBytes;
      limitError.value = null;
    } catch (error) {
      limitError.value = errorMessage(error, 'Could not reach the server to read its upload limit.');
    }
  }

  /**
   * Queue archives already on this machine (desktop shell): the server reads
   * them from disk, so they skip the browser's hashing and pre-flight and land
   * straight in `ready`. A batch of more than one shares a random group so its
   * traces gather into one run; blob reports ignore it. The server re-checks
   * everything and dedupes by content, so a duplicate still resolves cleanly.
   */
  function addLocalPaths(archives: { path: string; name: string; size: number }[]): void {
    const group = archives.length > 1 ? randomGroup() : undefined;
    const staged: ImportFileEntry[] = [];
    for (const archive of archives) {
      // A path already listed is not queued twice.
      if (entries.value.some((e) => e.path === archive.path)) continue;
      staged.push({
        id: nextId++,
        name: archive.name,
        size: archive.size,
        state: 'ready',
        progress: 0,
        path: archive.path,
        group,
      });
    }
    if (staged.length) entries.value = [...entries.value, ...staged];
  }

  async function addFiles(selected: File[]): Promise<void> {
    const staged: ImportFileEntry[] = selected.map((file) => ({
      id: nextId++,
      file,
      name: file.name,
      size: file.size,
      state: 'hashing',
      progress: 0,
    }));
    entries.value = [...entries.value, ...staged];

    // Work through the reactive proxies the ref just created, not the plain
    // objects staged above — mutating those would update the data without
    // telling the view about it, freezing every row on its initial state.
    const added = entries.value.slice(-staged.length);

    // Anything already over the limit is settled here — never read, never sent.
    const withinLimit: ImportFileEntry[] = [];
    for (const entry of added) {
      if (maxBytes.value != null && entry.size > maxBytes.value) {
        entry.state = 'too-large';
        // Deliberately says nothing about *where* the limit comes from: the
        // same page runs against a server and against the demo, which has none.
        entry.message = `${formatBytes(entry.size)} exceeds the ${formatBytes(maxBytes.value)} limit.`;
      } else if (entry.size === 0) {
        entry.state = 'invalid';
        entry.message = 'The file is empty.';
      } else if (!entry.name.toLowerCase().endsWith('.zip')) {
        entry.state = 'invalid';
        entry.message = 'Expected a .zip blob report (blob-report/report-*.zip).';
      } else {
        withinLimit.push(entry);
      }
    }

    if (withinLimit.length === 0) return;

    // Sequential, so a batch of large archives reads one at a time rather than
    // competing for the same disk.
    for (const entry of withinLimit) {
      // Every entry `addFiles` stages carries a browser file; only desktop
      // path entries (from `addLocalPaths`) skip this loop entirely.
      if (!entry.file) continue;
      try {
        entry.progress = 0;
        entry.hash = await sha256Blob(entry.file, (p) => {
          entry.progress = p;
        });
        entry.state = 'checking';
      } catch (error) {
        entry.state = 'failed';
        entry.message = errorMessage(error, 'Could not read the file.');
      } finally {
        entry.progress = 0;
      }
    }

    // Traces carry no run of their own, so the selection is the run: every file
    // chosen together shares one key. Derived from the digests rather than
    // generated, so re-importing the same selection reuses that run instead of
    // building a second copy of it. Blob reports ignore it.
    const group = await groupKeyFor(withinLimit);
    for (const entry of withinLimit) entry.group = group ?? undefined;

    await runPreflight(withinLimit.filter((e) => e.state === 'checking'));
  }

  /** Ask the server which of these archives are worth uploading. */
  async function runPreflight(pending: ImportFileEntry[]): Promise<void> {
    if (pending.length === 0 || !projectName.value) return;

    try {
      const response = await $fetch<ImportCheckResponse>('/api/test-runs/import/check', {
        method: 'POST',
        body: {
          projectName: projectName.value,
          files: pending.map((e) => ({ name: e.name, size: e.size, hash: e.hash })),
        },
      });

      maxBytes.value = response.maxBytes;
      response.results.forEach((result: ImportCheckResult, index: number) => {
        const entry = pending[index];
        if (!entry) return;
        entry.state = STATE_BY_VERDICT[result.status] ?? 'ready';
        entry.message = result.message;
        if (result.runId) entry.result = { runId: result.runId } as ImportRunResponse;
      });
    } catch (error) {
      // A pre-flight failure must not block the import — the server re-checks
      // everything anyway, so fall through and let the upload decide.
      const message = errorMessage(error, 'Pre-flight check failed.');
      for (const entry of pending) {
        entry.state = 'ready';
        entry.message = `${message} Importing will still verify it.`;
      }
    }
  }

  /** Upload every archive that cleared the pre-flight, one at a time. */
  async function startImport(): Promise<void> {
    if (importing.value || !projectName.value) return;
    importing.value = true;

    const queued = entries.value.filter((e) => UPLOADABLE.includes(e.state));
    batch.value = { done: 0, total: queued.length };

    try {
      for (const entry of queued) {
        entry.state = 'uploading';
        entry.message = undefined;
        entry.progress = 0;

        try {
          let result: ImportRunResponse;
          if (entry.path) {
            result = await importLocalArchive(entry.path, projectName.value, entry.group ?? null);
          } else if (entry.file) {
            result = await uploadArchive(
              importUrl,
              projectName.value,
              entry.file,
              entry.name,
              entry.group ?? null,
              (p) => {
                entry.progress = p;
              },
            );
          } else {
            throw new Error('Nothing to import.');
          }
          entry.result = result;
          entry.state = result.status === 'duplicate' ? 'duplicate' : 'imported';
          entry.message = result.status === 'duplicate' ? 'Already imported into this project.' : undefined;
        } catch (error) {
          entry.state = 'failed';
          entry.message = errorMessage(error, 'The import failed.');
        } finally {
          entry.progress = 0;
          batch.value = { ...batch.value, done: batch.value.done + 1 };
        }
      }
    } finally {
      importing.value = false;
    }
  }

  function remove(id: number): void {
    entries.value = entries.value.filter((e) => e.id !== id);
  }

  function clearFinished(): void {
    entries.value = entries.value.filter((e) => !['imported', 'duplicate'].includes(e.state));
  }

  return {
    entries,
    maxBytes,
    limitError,
    importing,
    readyCount,
    importedCount,
    busy,
    batch,
    loadLimit,
    addFiles,
    addLocalPaths,
    startImport,
    remove,
    clearFinished,
  };
}

/** A random hex grouping key, gathering a batch of dropped traces into one run. */
function randomGroup(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Import an archive the server can read from disk (desktop shell only). No
 * upload and no progress — the bytes never leave the machine — so this resolves
 * with the same summary a browser upload does.
 */
function importLocalArchive(path: string, projectName: string, group: string | null): Promise<ImportRunResponse> {
  return $fetch<ImportRunResponse>('/api/desktop/import-local', {
    method: 'POST',
    body: { path, projectName, importGroup: group ?? undefined },
  });
}

/** Prefix a path with the app's base URL, as `$fetch` does automatically. */
function withAppBase(path: string): string {
  const base = useRuntimeConfig().app.baseURL || '/';
  return `${base.replace(/\/$/, '')}${path}`;
}

/**
 * A stable identity for one batch: the digest of its files' digests, order
 * independent. Returns null when nothing in the batch was hashed, in which case
 * each trace imports as its own run.
 */
async function groupKeyFor(entries: ImportFileEntry[]): Promise<string | null> {
  const hashes = entries.map((entry) => entry.hash).filter((hash): hash is string => Boolean(hash));
  if (hashes.length === 0) return null;

  return new Sha256().update(new TextEncoder().encode([...hashes].sort().join(''))).hex();
}

/**
 * POST one archive with upload progress. `$fetch` cannot report progress, and
 * these bodies are large enough that a silent multi-minute wait reads as a hang.
 */
function uploadArchive(
  url: string,
  projectName: string,
  file: File,
  name: string,
  group: string | null,
  onProgress: (fraction: number) => void,
): Promise<ImportRunResponse> {
  return new Promise((resolve, reject) => {
    const body = new FormData();
    body.append('projectName', projectName);
    if (group) body.append('importGroup', group);
    body.append('archive', file, name);

    const request = new XMLHttpRequest();
    request.open('POST', url);
    request.responseType = 'json';

    request.upload.addEventListener('progress', (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    });

    request.addEventListener('load', () => {
      const payload = request.response as Record<string, unknown> | null;
      if (request.status >= 200 && request.status < 300) {
        resolve(payload as unknown as ImportRunResponse);
        return;
      }
      const detail = typeof payload?.message === 'string' ? payload.message : null;
      reject(new Error(detail ?? httpFallbackMessage(request.status)));
    });

    request.addEventListener('error', () => reject(new Error('The connection dropped during the upload.')));
    request.addEventListener('abort', () => reject(new Error('The upload was cancelled.')));
    request.addEventListener('timeout', () => reject(new Error('The upload timed out.')));

    request.send(body);
  });
}

/** Wording for statuses a proxy can produce without a JSON body of its own. */
function httpFallbackMessage(status: number): string {
  if (status === 413) return 'The server (or a proxy in front of it) rejected the archive as too large.';
  if (status === 401 || status === 403) return 'You do not have permission to import into this project.';
  if (status === 0) return 'The connection dropped during the upload.';
  if (status >= 500) return `The server failed while importing (HTTP ${status}).`;
  return `The import was rejected (HTTP ${status}).`;
}

function errorMessage(error: unknown, fallback: string): string {
  const data = (error as { data?: { message?: string } })?.data;
  if (typeof data?.message === 'string' && data.message) return data.message;
  const message = (error as Error)?.message;
  return message || fallback;
}
