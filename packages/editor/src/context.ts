/**
 * One Playwright config of the workspace and what the editor service knows
 * about it: the instance and project it reports to, the branch it reads, and
 * the project's indexes, fetched in the background and refreshed on a timer.
 * Nothing here blocks typing: a request answers from what is cached.
 */
import { createHash } from 'node:crypto';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { parseDotEnv, resolvePiwiConnection, type PiwiConnection } from '@piwitests/core/dotenv';
import type { LocatorIndex } from '@piwitests/core/locator-index';
import type { LocatorHealingResult } from '@piwitests/core/locator-healing-types';
import {
  PiwiClient,
  type BranchFailures,
  type CallSiteAlternatives,
  type CatalogCase,
  type CodeIndex,
} from './piwi-client.js';
import type { EditorCredentials } from './protocol.js';
import { committedText, currentBranch, headCommit, repositoryRoot, translationValues } from './workspace.js';

/** How long per-file answers (catalog, alternatives) are reused. */
const FILE_CACHE_MS = 5 * 60_000;

function readJson(file: string): unknown {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf-8'));
  } catch {
    return null;
  }
}

function readDotEnv(dir: string): Record<string, string> {
  try {
    return parseDotEnv(fs.readFileSync(path.join(dir, '.env'), 'utf-8'));
  } catch {
    return {};
  }
}

/**
 * The connection of a context: the environment, then the workspace `.env`
 * (the config's directory, then the repository root), then the desktop app's
 * discovery file, then the editor's own settings.
 */
export function resolveContextConnection(
  root: string,
  repoRoot: string,
  env: Record<string, string | undefined>,
  editor: EditorCredentials,
): PiwiConnection | null {
  const discovery = readJson(env.PIWI_DESKTOP_CONFIG || path.join(os.homedir(), '.piwi', 'desktop.json')) as {
    url?: unknown;
    token?: unknown;
  } | null;
  const desktop =
    discovery && typeof discovery.url === 'string' && typeof discovery.token === 'string'
      ? { url: discovery.url, token: discovery.token }
      : null;
  const found = resolvePiwiConnection({
    env,
    dotEnv: { ...readDotEnv(repoRoot), ...readDotEnv(root) },
    desktop,
  });
  if (found) {
    return {
      serverUrl: found.serverUrl,
      apiKey: found.apiKey ?? editor.apiKey ?? null,
      project: found.project || editor.project || '',
    };
  }
  if (!editor.serverUrl) return null;
  return {
    serverUrl: editor.serverUrl.replace(/\/+$/, ''),
    apiKey: editor.apiKey ?? null,
    project: editor.project ?? '',
  };
}

export class PiwiContext {
  repoRoot: string;
  client: PiwiClient | null = null;
  project: { id: number; name: string } | null = null;
  /** The branch the indexes describe; null for the default branch. */
  branch: string | null = null;
  index: LocatorIndex | null = null;
  codeIndex: CodeIndex | null = null;
  /** Why the context has no data, in one sentence; null when it has. */
  problem: string | null = null;
  /** The branch whose latest run is read: the checked-out one, else the default branch. */
  runBranch: string | null = null;
  /** The latest run on `runBranch` and its failures; null before the first answer. */
  failures: BranchFailures | null = null;
  private readonly healings = new Map<number, Promise<LocatorHealingResult | null>>();
  private readonly downloads = new Map<string, Promise<string | null>>();
  private readonly catalog = new Map<string, { at: number; items: CatalogCase[] }>();
  private readonly alternatives = new Map<string, { at: number; items: CallSiteAlternatives[] }>();
  private committedFiles = new Map<string, string | null>();
  private translations: { head: string | null; old?: Map<string, string>; new?: Map<string, string> } = { head: null };
  private head: string | null = null;

  constructor(
    /** The Playwright config's directory: call sites resolve against it. */
    readonly root: string,
  ) {
    this.repoRoot = root;
  }

  /**
   * Resolve the connection and project, then fetch the indexes. Never throws:
   * a failure is kept in `problem`, and cached data stays.
   */
  async refresh(env: Record<string, string | undefined>, editor: EditorCredentials): Promise<void> {
    this.repoRoot = await repositoryRoot(this.root);
    const head = await headCommit(this.repoRoot);
    if (head !== this.head) {
      this.head = head;
      this.committedFiles = new Map();
    }
    this.translations = { head: null };
    const connection = resolveContextConnection(this.root, this.repoRoot, env, editor);
    if (!connection) {
      this.client = null;
      this.problem = 'No Piwi instance configured: set PIWI_DASHBOARD_URL, run piwi init, or run Piwi: Connect.';
      return;
    }
    this.client = new PiwiClient(connection);
    try {
      if (!connection.project) {
        this.problem = 'No project chosen: set PIWI_PROJECT_NAME or run Piwi: Connect.';
        return;
      }
      if (!this.project || this.project.name !== connection.project) {
        this.project = await this.client.resolveProject(connection.project);
        if (!this.project) {
          this.problem = `No project named "${connection.project}" on ${connection.serverUrl}.`;
          return;
        }
      }
      const index = await this.client.locatorIndex(this.project.id, null);
      // The checked-out branch when the index has uses of its own for it, else the default branch.
      const checkedOut = await currentBranch(this.repoRoot);
      this.branch =
        checkedOut && checkedOut !== index.defaultBranch && index.branches.some((b) => b.name === checkedOut)
          ? checkedOut
          : null;
      this.index = this.branch ? await this.client.locatorIndex(this.project.id, this.branch) : index;
      this.codeIndex = await this.client.codeIndex(this.project.id, this.branch).catch(() => null);
      this.catalog.clear();
      this.alternatives.clear();
      this.problem = null;
      await this.refreshRun();
    } catch (e) {
      this.problem = `Could not reach ${connection.serverUrl}: ${(e as Error).message}`;
    }
  }

  /**
   * Fetch the latest run on the checked-out branch (the default branch on a
   * detached head). Returns whether the run or its failures changed.
   */
  async refreshRun(): Promise<boolean> {
    if (!this.client || !this.project) return false;
    const branch = (await currentBranch(this.repoRoot)) ?? this.index?.defaultBranch ?? null;
    try {
      const next = await this.client.branchFailures(this.project.id, branch);
      const changed = branch !== this.runBranch || JSON.stringify(next) !== JSON.stringify(this.failures);
      if (next.run?.id !== this.failures?.run?.id) this.healings.clear();
      this.runBranch = branch;
      this.failures = next;
      return changed;
    } catch {
      return false;
    }
  }

  /** The healing of a failed execution, fetched once. */
  healing(executionId: number): Promise<LocatorHealingResult | null> {
    if (!this.client) return Promise.resolve(null);
    let found = this.healings.get(executionId);
    if (!found) {
      found = this.client.locatorHealing(executionId).catch(() => null);
      this.healings.set(executionId, found);
    }
    return found;
  }

  /** A stored file downloaded to the temporary directory, once; null when it cannot be fetched. */
  evidence(storedPath: string): Promise<string | null> {
    const client = this.client;
    if (!client) return Promise.resolve(null);
    const key = `${client.connection.serverUrl}\n${storedPath}`;
    let found = this.downloads.get(key);
    if (!found) {
      const dir = path.join(os.tmpdir(), 'piwi-editor', createHash('sha256').update(key).digest('hex').slice(0, 16));
      const target = path.join(dir, path.basename(storedPath) || 'file');
      found = (async () => {
        if (fs.existsSync(target)) return target;
        try {
          const bytes = await client.file(storedPath);
          await fs.promises.mkdir(dir, { recursive: true });
          await fs.promises.writeFile(target, bytes);
          return target;
        } catch {
          this.downloads.delete(key);
          return null;
        }
      })();
      this.downloads.set(key, found);
    }
    return found;
  }

  /** The catalog's cases defined in a spec file (its path relative to the config). */
  async casesOf(relativeFile: string): Promise<CatalogCase[]> {
    if (!this.client || !this.project) return [];
    const cached = this.catalog.get(relativeFile);
    if (cached && Date.now() - cached.at < FILE_CACHE_MS) return cached.items;
    const items = await this.client.testCases(this.project.id, relativeFile).catch(() => [] as CatalogCase[]);
    this.catalog.set(relativeFile, { at: Date.now(), items });
    return items;
  }

  /** The stored alternatives of a file's call sites. */
  async alternativesOf(relativeFile: string): Promise<CallSiteAlternatives[]> {
    if (!this.client || !this.project) return [];
    const cached = this.alternatives.get(relativeFile);
    if (cached && Date.now() - cached.at < FILE_CACHE_MS) return cached.items;
    const items = await this.client.locatorAlternatives(this.project.id, relativeFile).catch(() => []);
    this.alternatives.set(relativeFile, { at: Date.now(), items });
    return items;
  }

  /** A file as `HEAD` holds it (repository-relative), cached until `HEAD` moves. */
  async committed(repoRelative: string): Promise<string | null> {
    if (!this.committedFiles.has(repoRelative)) {
      this.committedFiles.set(repoRelative, await committedText(this.repoRoot, repoRelative));
    }
    return this.committedFiles.get(repoRelative) ?? null;
  }

  /** Translation values of `HEAD` (`old`) and the working tree (`new`), rebuilt on each refresh. */
  async translationMaps(): Promise<{ old: Map<string, string>; new: Map<string, string> }> {
    if (this.translations.head !== this.head || !this.translations.old || !this.translations.new) {
      this.translations = {
        head: this.head,
        old: await translationValues(this.repoRoot, 'old'),
        new: await translationValues(this.repoRoot, 'new'),
      };
    }
    return { old: this.translations.old!, new: this.translations.new! };
  }
}
