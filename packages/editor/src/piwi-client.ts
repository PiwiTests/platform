/**
 * The requests the editor service makes to a Piwi instance. Every read is a
 * GET with the `pd_` key in `X-API-Key`; nothing from the workspace is sent
 * but file paths the index already holds.
 */
import type { LocatorIndex, LocatorIndexTest } from '@piwitests/core/locator-index';
import type { TestFunctionEntry } from '@piwitests/core/function-match';
import type { LocatorHealingResult, RankedLocator } from '@piwitests/core/locator-healing-types';
import type { PiwiConnection } from '@piwitests/core/dotenv';
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

/** The latest run on a branch and its failed executions (`GET /api/projects/:id/branch-failures`). */
export interface BranchFailures {
  run: {
    id: number;
    status: string;
    branch: string | null;
    startTime: string;
    totalTests: number;
    passedTests: number;
    failedTests: number;
    flakyTests: number;
    skippedTests: number;
  } | null;
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
  }>;
}

export type BranchFailure = BranchFailures['failures'][number];

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

  branchFailures(projectId: number, branch: string | null): Promise<BranchFailures> {
    return this.get(
      `/api/projects/${projectId}/branch-failures${branch ? `?branch=${encodeURIComponent(branch)}` : ''}`,
    );
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
}
