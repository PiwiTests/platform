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
import type { TestFunctionEntry } from '@piwitests/core/function-match';
import type { LocatorHealingResult } from '@piwitests/core/locator-healing-types';
import {
  PiwiClient,
  PiwiHttpError,
  type BranchFailures,
  type CallSiteAlternatives,
  type CatalogCase,
  type CodeIndex,
  type BranchFailure,
  type EntityLink,
  type FixPlan,
  type FlakyTest,
  type QuarantinedTest,
} from './piwi-client.js';
import type { TimeoutAdvice } from './analysis.js';
import type { ConnectionSource, EditorCredentials } from './protocol.js';
import { committedText, currentBranch, headCommit, repositoryRoot, translationValues } from './workspace.js';

/** Selections resolved at each refresh, at most. */
const MAX_SELECTIONS = 20;

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

/** Where the desktop app publishes its address, token and folder links while it runs. */
export function desktopConfigPath(env: Record<string, string | undefined>): string {
  return env.PIWI_DESKTOP_CONFIG || path.join(os.homedir(), '.piwi', 'desktop.json');
}

export interface DesktopDiscovery {
  url: string;
  token: string;
  /** The projects linked to a folder on this machine in the desktop app. */
  projects: Array<{ id: number; path: string }>;
}

/** The running desktop app, from its discovery file; null when it does not run. */
export function readDesktopDiscovery(env: Record<string, string | undefined>): DesktopDiscovery | null {
  const discovery = readJson(desktopConfigPath(env)) as { url?: unknown; token?: unknown; projects?: unknown } | null;
  if (!discovery || typeof discovery.url !== 'string' || typeof discovery.token !== 'string') return null;
  const projects = Array.isArray(discovery.projects)
    ? discovery.projects.flatMap((p: { id?: unknown; path?: unknown }) =>
        typeof p?.id === 'number' && typeof p.path === 'string' && p.path ? [{ id: p.id, path: p.path }] : [],
      )
    : [];
  return { url: discovery.url.replace(/\/+$/, ''), token: discovery.token, projects };
}

function isInside(child: string, parent: string): boolean {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return !relative.startsWith('..') && !path.isAbsolute(relative);
}

/**
 * The project the desktop app links to this context's folder: the linked folder
 * that holds the Playwright config, or one inside it; the deepest wins.
 */
export function linkedDesktopProject(desktop: DesktopDiscovery | null, root: string): number | null {
  const matches = (desktop?.projects ?? [])
    .filter((p) => isInside(root, p.path) || isInside(p.path, root))
    .sort((a, b) => b.path.length - a.path.length);
  return matches[0]?.id ?? null;
}

/**
 * The connection of a context: the environment, then the workspace `.env`
 * (the config's directory, then the repository root), then the instance saved
 * with Connect in the editor, then the desktop app running on this machine.
 * The editor's saved choice comes before the desktop app: it is explicit, the
 * app is only running. With the desktop app, the project is the one named by
 * `PIWI_PROJECT_NAME` or saved in the editor, else the one linked there to
 * this folder.
 */
export function resolveContextConnection(
  root: string,
  repoRoot: string,
  env: Record<string, string | undefined>,
  editor: EditorCredentials,
): (PiwiConnection & { source: ConnectionSource }) | null {
  const desktop = readDesktopDiscovery(env);
  const dotEnv = { ...readDotEnv(repoRoot), ...readDotEnv(root) };
  const namedProject = env.PIWI_PROJECT_NAME || dotEnv.PIWI_PROJECT_NAME || '';
  const linked = () => {
    const id = linkedDesktopProject(desktop, root);
    return id === null ? '' : String(id);
  };
  if (env.PIWI_DASHBOARD_URL || dotEnv.PIWI_DASHBOARD_URL) {
    const found = resolvePiwiConnection({ env, dotEnv, desktop })!;
    // The key saved in the editor belongs to the server it was saved for: a URL
    // from the environment or a workspace `.env` never gets another's.
    const editorUrl = editor.serverUrl?.replace(/\/+$/, '');
    return {
      serverUrl: found.serverUrl,
      apiKey: found.apiKey ?? (editorUrl === found.serverUrl ? (editor.apiKey ?? null) : null),
      project: found.project || editor.project || (desktop?.url === found.serverUrl ? linked() : ''),
      source: env.PIWI_DASHBOARD_URL ? 'environment' : 'dotenv',
    };
  }
  if (editor.serverUrl) {
    return {
      serverUrl: editor.serverUrl.replace(/\/+$/, ''),
      apiKey: editor.apiKey ?? null,
      project: editor.project || namedProject,
      source: 'editor',
    };
  }
  if (!desktop) return null;
  return {
    serverUrl: desktop.url,
    apiKey: desktop.token,
    project: namedProject || editor.project || linked(),
    source: 'desktop',
  };
}

/** The owners a repository's CODEOWNERS file names: `@team`, `@user`, emails. */
function codeOwners(repoRoot: string): string[] {
  const owners = new Set<string>();
  for (const file of ['.github/CODEOWNERS', 'CODEOWNERS', 'docs/CODEOWNERS']) {
    let text: string;
    try {
      text = fs.readFileSync(path.join(repoRoot, file), 'utf-8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      const fields = line.replace(/#.*$/, '').trim().split(/\s+/).slice(1);
      for (const f of fields) if (/^@[\w./-]+$/.test(f) || /^[^@\s]+@[^@\s]+$/.test(f)) owners.add(f);
    }
  }
  return [...owners].sort();
}

export class PiwiContext {
  repoRoot: string;
  client: PiwiClient | null = null;
  /** Where the client's instance came from; null without one. */
  source: ConnectionSource | null = null;
  project: { id: number; name: string } | null = null;
  /** The branch the indexes describe; null for the default branch. */
  branch: string | null = null;
  index: LocatorIndex | null = null;
  codeIndex: CodeIndex | null = null;
  /** Why the context has no data, in one sentence; null when it has. */
  problem: string | null = null;
  /** The branch whose latest run is read: the checked-out one, else the default branch. */
  runBranch: string | null = null;
  /** Quarantined tests by test case id, and the passing streak that releases one. */
  quarantined = new Map<number, QuarantinedTest>();
  releaseAfter = 0;
  /** The project's selections and the tests each selects, resolved at each refresh. */
  selections: Array<{ key: string; name: string; tests: Set<number>; command: string }> = [];
  /** Tests whose timeout could be tighter, by test case id. */
  timeouts = new Map<number, TimeoutAdvice>();
  /** The project's flaky tests on the branch the indexes describe, by test case id. */
  flaky = new Map<number, FlakyTest>();
  /** The latest run on `runBranch` and its failures; null before the first answer. */
  failures: BranchFailures | null = null;
  private functions: { at: number; items: TestFunctionEntry[] } | null = null;
  private words: { at: number; value: { tags: string[]; features: string[] } } | null = null;
  private readonly issues = new Map<number, Promise<EntityLink[]>>();
  private readonly fixPlans = new Map<number, Promise<FixPlan | null>>();
  private readonly fixPlanTexts = new Map<number, Promise<string | null>>();
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
      this.source = null;
      this.problem = 'No Piwi instance configured: set PIWI_DASHBOARD_URL, run piwi init, or run Piwi: Connect.';
      return;
    }
    this.client = new PiwiClient(connection);
    this.source = connection.source;
    try {
      if (!connection.project) {
        this.problem =
          connection.source === 'desktop'
            ? "No project linked to this folder in the Piwi desktop app: link it on the project's page there, or run Piwi: Connect."
            : 'No project chosen: set PIWI_PROJECT_NAME or run Piwi: Connect.';
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
      const flaky = await this.client.flakyTests(this.project.id, this.branch).catch(() => null);
      if (flaky) this.flaky = new Map(flaky.map((f) => [f.testCaseId, f]));
      const quarantine = await this.client.quarantine(this.project.id).catch(() => null);
      if (quarantine) {
        this.quarantined = new Map(quarantine.entries.map((q) => [q.testCaseId, q]));
        this.releaseAfter = quarantine.releaseAfter;
      }
      const selections = await this.client.selections(this.project.id).catch(() => null);
      if (selections) {
        const project = this.project;
        const client = this.client;
        this.selections = (
          await Promise.all(
            selections.slice(0, MAX_SELECTIONS).map(async (s) => {
              const resolved = await client.resolveSelection(project.id, s.key).catch(() => null);
              return resolved
                ? {
                    key: s.key,
                    name: s.name,
                    tests: new Set(resolved.tests.map((t) => t.testCaseId)),
                    command: resolved.materialization.command,
                  }
                : null;
            }),
          )
        ).filter((s): s is NonNullable<typeof s> => !!s);
      }
      const timeouts = await this.client.timeoutOpportunities(this.project.id).catch(() => null);
      if (timeouts) this.timeouts = new Map(timeouts.map((t) => [t.testCaseId, t]));
      this.catalog.clear();
      this.alternatives.clear();
      this.functions = null;
      this.words = null;
      // Completion reads these: fetched here, so no keystroke waits on them.
      await Promise.all([this.functionCatalog(), this.vocabulary()]);
      this.problem = null;
      await this.refreshRun();
    } catch (e) {
      const refused = e instanceof PiwiHttpError && (e.status === 401 || e.status === 403);
      this.problem = refused
        ? connection.apiKey
          ? `${connection.serverUrl} refused the API key (${e.status}): run Piwi: Connect to sign in again.`
          : `${connection.serverUrl} needs an API key (${e.status}): run Piwi: Connect to sign in.`
        : `Could not reach ${connection.serverUrl}: ${(e as Error).message}`;
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
      if (next.run?.id !== this.failures?.run?.id) {
        this.healings.clear();
        this.issues.clear();
        this.fixPlans.clear();
        this.fixPlanTexts.clear();
      }
      this.runBranch = branch;
      this.failures = next;
      return changed;
    } catch {
      return false;
    }
  }

  /** The project's function catalog, reused for five minutes. */
  async functionCatalog(): Promise<TestFunctionEntry[]> {
    if (!this.client || !this.project) return [];
    if (this.functions && Date.now() - this.functions.at < FILE_CACHE_MS) return this.functions.items;
    const items = await this.client.testFunctions(this.project.id).catch(() => this.functions?.items ?? []);
    this.functions = { at: Date.now(), items };
    return items;
  }

  /** The tickets linked to a failure's cluster or test, fetched once per run. */
  issuesOf(failure: BranchFailure): Promise<EntityLink[]> {
    const client = this.client;
    if (!client) return Promise.resolve([]);
    let found = this.issues.get(failure.executionId);
    if (!found) {
      found = Promise.all([
        failure.clusterId ? client.links('failure_cluster', failure.clusterId).catch(() => []) : [],
        client.links('test_case', failure.testCaseId).catch(() => []),
      ]).then(([cluster, test]) => [...new Map([...cluster, ...test].map((l) => [l.url, l])).values()]);
      this.issues.set(failure.executionId, found);
    }
    return found;
  }

  /** A failure cluster's fix plan, fetched once per run. */
  fixPlan(clusterId: number): Promise<FixPlan | null> {
    if (!this.client) return Promise.resolve(null);
    let found = this.fixPlans.get(clusterId);
    if (!found) {
      found = this.client.fixPlan(clusterId).catch(() => null);
      this.fixPlans.set(clusterId, found);
    }
    return found;
  }

  /** The same plan as Markdown, fetched once per run. */
  fixPlanText(clusterId: number): Promise<string | null> {
    if (!this.client) return Promise.resolve(null);
    let found = this.fixPlanTexts.get(clusterId);
    if (!found) {
      found = this.client.fixPlanMarkdown(clusterId).catch(() => null);
      this.fixPlanTexts.set(clusterId, found);
    }
    return found;
  }

  /** Tags and features (reused for five minutes) and the workspace's CODEOWNERS owners, for annotation completion. */
  async vocabulary(): Promise<{ tags: string[]; features: string[]; owners: string[] }> {
    if (!this.words || Date.now() - this.words.at >= FILE_CACHE_MS) {
      const value =
        this.client && this.project
          ? await this.client.vocabulary(this.project.id).catch(() => ({ tags: [], features: [] }))
          : { tags: [], features: [] };
      this.words = { at: Date.now(), value };
    }
    return { ...this.words.value, owners: codeOwners(this.repoRoot) };
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
      // The name comes from the server and ends up in a `show-trace "<path>"` command: keep it to plain characters.
      const name = path.basename(storedPath).replace(/[^\w.-]/g, '_');
      const target = path.join(dir, name && name !== '.' && name !== '..' ? name : 'file');
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
