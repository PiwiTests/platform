/**
 * The requests the editor service makes to a Piwi instance. Every read is a
 * GET with the `pd_` key in `X-API-Key`; nothing from the workspace is sent
 * but file paths the index already holds.
 */
import type { LocatorIndex, LocatorIndexTest } from '@piwitests/core/locator-index';
import type { TestFunctionEntry } from '@piwitests/core/function-match';
import type { LocatorHealingResult, RankedLocator } from '@piwitests/core/locator-healing-types';
import type { PiwiConnection } from '@piwitests/core/dotenv';
import type { BisectResultBody } from '@piwitests/core/bisect';
import type { DesktopJobRequest, DesktopJobVerdict, FlakeLabJobPlan } from '@piwitests/core/desktop-job';
import type { TimeoutAdvice } from './analysis.js';

const TIMEOUT_MS = 15_000;

export class PiwiHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'PiwiHttpError';
  }
}

/** The code index: the source files the project's tests reach. */
export interface CodeIndex {
  files: string[];
  tests: LocatorIndexTest[];
  reach: Array<{ file: number; tests: number[]; origin: 'client' | 'server' }>;
  builtAt: string | null;
  truncated: boolean;
}

/** One test case of the catalog. */
export interface CatalogCase {
  id: number;
  title: string;
  filePath: string;
  /** Its `describe` blocks, outermost first, joined by `\x1f` (`Auth\x1fLogin`); empty outside any. */
  suitePath?: string | null;
  /** `passed`, `failed`, `flaky`, `skipped`, `didnotrun` or `never-run`, from the latest executions. */
  status?: string | null;
  totalRuns?: number;
  passedRuns?: number;
  failedRuns?: number;
  flakyRuns?: number;
}

/** The stored alternatives of one call site. */
export interface CallSiteAlternatives {
  testCaseId: number;
  location: string;
  method: string;
  alternatives: RankedLocator[];
  lastSeenAt: string;
}

/**
 * The latest complete run on a branch, the later runs of the branch laid over it, its failed executions as they stand
 * after them, and the failures they passed (`GET /api/projects/:id/branch-failures?overlays=1`). The fields an instance
 * older than the overlays does not send are optional.
 */
export interface BranchFailures {
  run: {
    id: number;
    status: string;
    branch: string | null;
    startTime: string;
    /** What launched it: `ci`, `ci-rerun`, `local`, `desktop`, `editor`… */
    origin?: string;
    /** The commit it ran at; null when the reporter recorded none. */
    commit?: string | null;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    flakyTests: number;
    skippedTests: number;
  } | null;
  /** The finished runs of the branch started after `run`, whole or partial, newest first. */
  overlays?: Array<{
    id: number;
    status: string;
    /** What launched it: `ci`, `ci-rerun`, `local`, `desktop`, `editor`… */
    origin: string;
    isFullRun: boolean;
    startTime: string;
    commit: string | null;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    flakyTests: number;
    skippedTests: number;
  }>;
  failures: Array<{
    executionId: number;
    testCaseId: number;
    clusterId?: number | null;
    title: string;
    file: string;
    line: number | null;
    status: string;
    headline: string | null;
    location: string | null;
    /** Absent from an instance older than the editor service. */
    message?: string | null;
    /** The error's frames outside `node_modules`, innermost first; absent from an instance older than the editor service. */
    frames?: string[];
    traces: string[];
    screenshot: string | null;
    /** `baseline` for an execution of `run`, `overlay` for one of `overlays`. */
    source?: 'baseline' | 'overlay';
    /** The run the execution belongs to. */
    runId?: number;
    /** The Playwright project; null when unknown. */
    browserName?: string | null;
    /** In milliseconds; null when not recorded. */
    duration?: number | null;
    /** A new regression in `run`, or, from an overlay, a test that did not fail on this project in `run`. */
    isNew?: boolean;
    clusterTitle?: string | null;
    owner?: string | null;
    /** What an overlay says about the test on another project: `passed on chromium in run #124`. */
    note?: string;
  }>;
  /** The failures of `run` an overlay passed since, on the same Playwright project. */
  resolved?: Array<{
    testCaseId: number;
    title: string;
    /** The spec file and the line of the `test(…)` call, as the passing run reported them. */
    file: string;
    line: number | null;
    browserName: string | null;
    /** The overlay that passed it, and its passing execution. */
    runId: number;
    executionId: number;
    /** The execution that failed in `run`. */
    baselineExecutionId: number;
  }>;
}

export type BranchFailure = BranchFailures['failures'][number];
export type BranchResolved = NonNullable<BranchFailures['resolved']>[number];

/** The fields the editor reads of a run's details (`GET /api/test-runs/:id`). */
export interface RunDetails {
  id: number;
  /** `running`, `initializing`, `finalizing`, or the final status. */
  status: string;
  branch: string | null;
  startTime: string;
  /** Holds what launched it, under `piwiOrigin`. */
  metadata?: Record<string, unknown> | null;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  didNotRunTests?: number;
  flakyTests?: number;
}

/** A flaky test as the flaky list ranks it (`GET /api/projects/:id/flaky-tests`). */
export interface FlakyTest {
  testCaseId: number;
  /** 1–100, from retry passes and pass/fail alternation. */
  score: number;
  /** CI minutes spent re-running it. */
  wastedCiMinutes: number;
  /** `timing`, `network`, `assertion`, `environment` or `other`; null when unclassified. */
  rootCause: string | null;
}

/** A test of the project's Flake Lab (`GET /api/projects/:id/flake-lab?suspects=true`). */
export interface FlakeLabEntry {
  testCaseId: number;
  /** `untested`, `not-reproduced`, `amplified`, `reproduced`, `still-fails`, `inconclusive`, `verified` or `flaked-again`. */
  state: string;
  /** The `piwi flake` command it needs next; null once its fix holds. */
  nextCommand: string | null;
  flaky: boolean;
  /** The condition that last reproduced it. */
  reproducedBy: string | null;
  /** Share of the runs read in which it failed at least once; absent from an older instance. */
  flakeRate?: number | null;
  /** The suspect it is shown with; absent from an older instance or past the instance's limit. */
  suspect?: { id: string; label: string; standing: string; lab: string } | null;
  /** How many of its suspects no experiment tested; absent from an older instance or past the instance's limit. */
  untestedSuspects?: number;
}

/**
 * A test's reproduce plan as the instance answers `GET /api/test-cases/:id/flake-plan`: the fields a Flake Lab job
 * runs, beside the suspects the command line prints.
 */
export type FlakePlan = Omit<FlakeLabJobPlan, 'suspects' | 'verifies'> & { suspects?: unknown[]; verifies?: unknown };

/** One arm's counts and conditions, as `POST /api/projects/:id/flake-lab/results` takes them. */
export interface FlakeArmResult {
  id: string;
  label: string;
  suspectId: string | null;
  conditions: unknown[];
  runs: number;
  matchingFailures: number;
  otherFailures: number;
  discardedRounds: number;
  stoppedEarly: boolean;
}

/** The body of `POST /api/projects/:id/flake-lab/results`. */
export interface FlakeResultsBody {
  experimentId: string;
  commit: string | null;
  playwrightProject: string | null;
  arms: FlakeArmResult[];
}

/** A ticket or page linked to a failure cluster or a test (`GET /api/links`). */
export interface EntityLink {
  url: string;
  /** Compact id, `PROJ-123` or `#456`. */
  key: string | null;
  title: string | null;
  statusText: string | null;
}

/** A quarantined test and its way out (`GET /api/projects/:id/quarantine`). */
export interface QuarantinedTest {
  testCaseId: number;
  /** How long it has been quarantined, in ms. */
  ageMs: number;
  consecutivePasses: number;
  releaseProposed: boolean;
}

/** The parts of a cluster's fix plan the editors use. */
export interface FixPlan {
  cluster: { id: number; title: string | null; signature: string };
  diagnosis: {
    summary: string | null;
    patch: string | null;
    patchValidation: { status: string; errors: string[] } | null;
  } | null;
  edits: Array<{
    filePath: string;
    line: number | null;
    suggestedLocator: string | null;
    edit: { filePath: string | null; line: number; oldLine: string; newLine: string } | null;
  }>;
  verify: { command: string; expectation: string };
}

/** What a reproduction of an execution needs on this machine (`desktop` of `GET /api/test-run-cases/:id/reproduce`). */
export interface ReproduceDesktop {
  cases: Array<{ filePath: string; title: string; line?: number | null; projectName?: string | null }>;
  browserName: string | null;
  commit: string | null;
  /** The bisect window: the last green commit and the failing one. */
  good: string | null;
  bad: string | null;
  clusterId: number | null;
}

/** A job request as the desktop app answers `GET /api/desktop/repro-requests/:id`. */
export interface DesktopJobState {
  id: string;
  status: 'waiting' | 'running' | 'done' | 'declined' | 'expired';
  jobVerdict: DesktopJobVerdict | null;
}

export class PiwiClient {
  constructor(readonly connection: PiwiConnection) {}

  private async get<T>(path: string): Promise<T> {
    const response = await fetch(`${this.connection.serverUrl}${path}`, {
      headers: this.connection.apiKey ? { 'X-API-Key': this.connection.apiKey } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new PiwiHttpError(`${path} answered ${response.status}`, response.status);
    return (await response.json()) as T;
  }

  private async post<T>(path: string, body: unknown): Promise<T> {
    const response = await fetch(`${this.connection.serverUrl}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.connection.apiKey ? { 'X-API-Key': this.connection.apiKey } : {}),
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new PiwiHttpError(`${path} answered ${response.status}`, response.status);
    return (await response.json()) as T;
  }

  /** The projects the key can open. */
  async projects(): Promise<Array<{ id: number; name: string }>> {
    const body = await this.get<{ items?: Array<{ id: number; name: string }> }>('/api/projects/menu');
    return body.items ?? [];
  }

  /** The project a name or a numeric id names; null when none does. */
  async resolveProject(project: string): Promise<{ id: number; name: string } | null> {
    const all = await this.projects();
    if (/^\d+$/.test(project))
      return all.find((p) => p.id === Number(project)) ?? { id: Number(project), name: project };
    return all.find((p) => p.name.toLowerCase() === project.toLowerCase()) ?? null;
  }

  locatorIndex(projectId: number, branch: string | null): Promise<LocatorIndex> {
    return this.get(`/api/projects/${projectId}/locator-index${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`);
  }

  codeIndex(projectId: number, branch: string | null): Promise<CodeIndex> {
    return this.get(`/api/projects/${projectId}/code-index${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`);
  }

  async testCases(projectId: number, file: string): Promise<CatalogCase[]> {
    const body = await this.get<{ items?: CatalogCase[] }>(
      `/api/projects/${projectId}/test-cases?limit=1000&file=${encodeURIComponent(file)}`,
    );
    return body.items ?? [];
  }

  async locatorAlternatives(projectId: number, file: string): Promise<CallSiteAlternatives[]> {
    const body = await this.get<{ items?: CallSiteAlternatives[] }>(
      `/api/projects/${projectId}/locator-alternatives?file=${encodeURIComponent(file)}`,
    );
    return body.items ?? [];
  }

  /** The Playwright arguments and command that run these tests, through the selection resolver. */
  async runArgs(projectId: number, testIds: number[]): Promise<{ args: string[]; command: string }> {
    const body = await this.post<{ materialization?: { args?: string[]; command?: string } }>(
      `/api/projects/${projectId}/selections/preview`,
      { definition: { include: [{ ids: testIds }] }, format: 'args' },
    );
    return { args: body.materialization?.args ?? [], command: body.materialization?.command ?? '' };
  }

  /**
   * The latest complete run on `branch` (any branch when null), with the later runs of its branch laid over it; with
   * `run`, that run instead; with `origin: 'local'`, a developer's own runs only, laid over none when no complete one
   * exists. An instance older than these answers as if they were absent.
   */
  branchFailures(
    projectId: number,
    branch: string | null,
    baseline: { run?: number; origin?: 'local' } = {},
  ): Promise<BranchFailures> {
    const query = new URLSearchParams(branch ? { branch, overlays: '1' } : { overlays: '1' });
    if (baseline.run !== undefined) query.set('run', String(baseline.run));
    if (baseline.origin) query.set('origin', baseline.origin);
    return this.get(`/api/projects/${projectId}/branch-failures?${query}`);
  }

  /** A run's details, with what launched it in its metadata. */
  runDetails(runId: number): Promise<RunDetails> {
    return this.get(`/api/test-runs/${runId}`);
  }

  /** The newest run of the project whose launcher stamped this origin and ref (`PIWI_ORIGIN_REF`); null when none. */
  latestRunByRef(projectId: number, origin: string, ref: string): Promise<{ id: number; status: string } | null> {
    const query = new URLSearchParams({ origin, ref });
    return this.get(`/api/projects/${projectId}/latest-run?${query}`);
  }

  /** The instance's run events (`GET /api/stream`): a response whose body is a server-sent events stream. */
  events(signal: AbortSignal): Promise<Response> {
    return this.stream('/api/stream', signal);
  }

  /** One run's events (`GET /api/test-runs/:id/stream`), until it ends. */
  runEvents(runId: number, signal: AbortSignal): Promise<Response> {
    return this.stream(`/api/test-runs/${runId}/stream`, signal);
  }

  /** A server-sent events stream, open until it ends or `signal` aborts. */
  private stream(path: string, signal: AbortSignal): Promise<Response> {
    return fetch(`${this.connection.serverUrl}${path}`, {
      headers: {
        Accept: 'text/event-stream',
        ...(this.connection.apiKey ? { 'X-API-Key': this.connection.apiKey } : {}),
      },
      signal,
    });
  }

  locatorHealing(executionId: number): Promise<LocatorHealingResult> {
    return this.get(`/api/test-run-cases/${executionId}/locator-healing`);
  }

  /** The project's function catalog: the helpers and page-object methods recordings call. */
  async testFunctions(projectId: number): Promise<TestFunctionEntry[]> {
    const body = await this.get<{ testFunctions?: Array<{ entry?: TestFunctionEntry }> }>(
      `/api/projects/${projectId}/test-functions`,
    );
    return (body.testFunctions ?? []).map((row) => row.entry).filter((e): e is TestFunctionEntry => !!e);
  }

  /** A stored file's bytes (`/api/files/<path>`). */
  async file(storedPath: string): Promise<Uint8Array> {
    const encoded = storedPath.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${this.connection.serverUrl}/api/files/${encoded}`, {
      headers: this.connection.apiKey ? { 'X-API-Key': this.connection.apiKey } : {},
      signal: AbortSignal.timeout(TIMEOUT_MS * 4),
    });
    if (!response.ok) throw new PiwiHttpError(`/api/files answered ${response.status}`, response.status);
    return new Uint8Array(await response.arrayBuffer());
  }

  async flakyTests(projectId: number, branch: string | null): Promise<FlakyTest[]> {
    const body = await this.get<{ items?: FlakyTest[] }>(
      `/api/projects/${projectId}/flaky-tests${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`,
    );
    return body.items ?? [];
  }

  /** The project's Flake Lab tests, each with its top suspect. */
  async flakeLab(projectId: number, branch: string | null): Promise<FlakeLabEntry[]> {
    const query = new URLSearchParams({ suspects: 'true', limit: '1' });
    if (branch) query.set('branch', branch);
    const body = await this.get<{ tests?: FlakeLabEntry[] }>(`/api/projects/${projectId}/flake-lab?${query}`);
    return body.tests ?? [];
  }

  async links(entityType: 'failure_cluster' | 'test_case', entityId: number): Promise<EntityLink[]> {
    const body = await this.get<{ items?: EntityLink[] }>(`/api/links?entityType=${entityType}&entityId=${entityId}`);
    return body.items ?? [];
  }

  async quarantine(projectId: number): Promise<{ entries: QuarantinedTest[]; releaseAfter: number }> {
    const body = await this.get<{ entries?: QuarantinedTest[]; releaseAfterConsecutivePasses?: number }>(
      `/api/projects/${projectId}/quarantine?candidates=false`,
    );
    return { entries: body.entries ?? [], releaseAfter: body.releaseAfterConsecutivePasses ?? 0 };
  }

  /** The tags and features the project's tests declare, and the Test Map's features. */
  async vocabulary(projectId: number): Promise<{ tags: string[]; features: string[] }> {
    const [catalog, map] = await Promise.all([
      this.get<{ items?: Array<{ tags?: string[] | null; feature?: string | null }> }>(
        `/api/projects/${projectId}/test-cases?limit=1000`,
      ).catch(() => ({ items: [] })),
      this.get<{ features?: Array<{ key: string }> }>(`/api/projects/${projectId}/feature-map`).catch(() => ({
        features: [],
      })),
    ]);
    const tags = new Set<string>();
    const features = new Set<string>();
    for (const item of catalog.items ?? []) {
      for (const tag of item.tags ?? []) tags.add(tag);
      if (item.feature) features.add(item.feature);
    }
    for (const f of map.features ?? []) features.add(f.key);
    return { tags: [...tags].sort(), features: [...features].sort() };
  }

  /** The project's saved and built-in selections. */
  async selections(projectId: number): Promise<Array<{ key: string; name: string }>> {
    const body = await this.get<{ items?: Array<{ key: string; name?: string | null }> }>(
      `/api/projects/${projectId}/selections`,
    );
    return (body.items ?? []).map((s) => ({ key: s.key, name: s.name || s.key }));
  }

  /** A selection resolved now: its tests and the command that runs them. */
  resolveSelection(
    projectId: number,
    key: string,
  ): Promise<{ tests: Array<{ testCaseId: number }>; materialization: { args: string[]; command: string } }> {
    return this.get(`/api/projects/${projectId}/selections/${encodeURIComponent(key)}/resolve`);
  }

  async timeoutOpportunities(projectId: number): Promise<TimeoutAdvice[]> {
    const body = await this.get<{ items?: TimeoutAdvice[] }>(`/api/projects/${projectId}/timeout-opportunities`);
    return body.items ?? [];
  }

  /** A failure cluster's page in the dashboard. */
  clusterUrl(clusterId: number): string {
    return `${this.connection.serverUrl}/failure-clusters/${clusterId}`;
  }

  /** A failure cluster's fix plan (`GET /api/failure-clusters/:id/fix-plan`). */
  fixPlan(clusterId: number): Promise<FixPlan> {
    return this.get(`/api/failure-clusters/${clusterId}/fix-plan`);
  }

  /** The same plan as Markdown, for an agent. */
  async fixPlanMarkdown(clusterId: number): Promise<string> {
    const response = await fetch(
      `${this.connection.serverUrl}/api/failure-clusters/${clusterId}/fix-plan?format=markdown`,
      {
        headers: this.connection.apiKey ? { 'X-API-Key': this.connection.apiKey } : {},
        signal: AbortSignal.timeout(TIMEOUT_MS),
      },
    );
    if (!response.ok) throw new PiwiHttpError(`fix-plan answered ${response.status}`, response.status);
    return response.text();
  }

  /** What a reproduction of an execution needs, and why a bisect is not possible when it is not. */
  async reproduceDesktop(executionId: number): Promise<{ desktop: ReproduceDesktop; bisectReason: string | null }> {
    const body = await this.get<{ desktop: ReproduceDesktop; bisect: { available: boolean; reason?: string } }>(
      `/api/test-run-cases/${executionId}/reproduce`,
    );
    return { desktop: body.desktop, bisectReason: body.bisect.available ? null : (body.bisect.reason ?? null) };
  }

  /** Record a bisect's first bad commit on a failure cluster (`POST /api/failure-clusters/:id/bisect`). */
  recordBisect(clusterId: number, result: BisectResultBody): Promise<unknown> {
    return this.post(`/api/failure-clusters/${clusterId}/bisect`, result);
  }

  /**
   * A test's reproduce plan, recorded as an experiment the desktop app on `machine` runs; its results are posted with
   * {@link recordFlakeResults}.
   */
  flakePlan(testCaseId: number, machine: string): Promise<FlakePlan> {
    const query = new URLSearchParams({ kind: 'reproduce', source: 'desktop', machine, record: 'true' });
    return this.get(`/api/test-cases/${testCaseId}/flake-plan?${query}`);
  }

  /** Record what an experiment's arms measured (`POST /api/projects/:id/flake-lab/results`). */
  recordFlakeResults(projectId: number, body: FlakeResultsBody): Promise<{ verdict: string }> {
    return this.post(`/api/projects/${projectId}/flake-lab/results`, body);
  }

  /** Desktop app only: pass it a job, which waits for the developer in its window. */
  createDesktopJob(job: DesktopJobRequest): Promise<{ id: string; windowOpen: boolean }> {
    return this.post('/api/desktop/repro-requests', job);
  }

  /** Desktop app only: a job's status and, once done, its verdict. */
  desktopJob(id: string): Promise<DesktopJobState> {
    return this.get(`/api/desktop/repro-requests/${encodeURIComponent(id)}`);
  }

  /** An execution's page in the dashboard. */
  executionUrl(executionId: number): string {
    return `${this.connection.serverUrl}/test-run-cases/${executionId}`;
  }

  /** A run's page in the dashboard. */
  runUrl(runId: number): string {
    return `${this.connection.serverUrl}/test-runs/${runId}`;
  }

  /** A test case's page in the dashboard. */
  testUrl(testCaseId: number): string {
    return `${this.connection.serverUrl}/test-cases/${testCaseId}`;
  }

  /** A test case's Flakiness tab. */
  flakinessUrl(testCaseId: number): string {
    return `${this.testUrl(testCaseId)}?tab=flakiness`;
  }
}
