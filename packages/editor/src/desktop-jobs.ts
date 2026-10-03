/**
 * Jobs the editor passes from the instance it reads to the desktop app running
 * on this machine: reproduce a failure at its commit, or bisect it. The job
 * names commits and tests, never code; the app shows it in its window and runs
 * nothing until the developer starts it there. The service polls the app for
 * the verdict and, asked to, shares it on the instance with the editor's own
 * key: the app never receives that key.
 */
import type { DesktopJobRequest, DesktopJobVerdict } from '@piwitests/core/desktop-job';
import { readDesktopDiscovery } from './context.js';
import { PiwiClient, PiwiHttpError } from './piwi-client.js';
import type { BranchFailure } from './piwi-client.js';
import type { DesktopJobKind, DesktopJobResult, DesktopJobUpdate, ShareDesktopJobResult } from './protocol.js';

/** How often a job's state is read from the app. */
const POLL_MS = 3_000;
/** Reads in a row the app may fail to answer before the job counts as gone. */
const MAX_MISSES = 5;

/** The instance a failure came from: what the context reads. */
export interface JobSource {
  client: PiwiClient;
}

interface Job {
  id: string;
  kind: DesktopJobKind;
  title: string;
  commit: string;
  clusterId: number | null;
  instance: PiwiClient;
  desktop: PiwiClient;
  status: DesktopJobUpdate['status'] | 'waiting';
  verdict: DesktopJobVerdict | null;
  misses: number;
  shared: boolean;
}

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

const short = (sha: string) => sha.slice(0, 7);

/** The sentence a job's verdict reads as. */
export function verdictMessage(
  kind: DesktopJobKind,
  title: string,
  commit: string,
  verdict: DesktopJobVerdict,
): string {
  switch (verdict.kind) {
    case 'reproduced':
      return `Reproduced at ${short(commit)}: "${title}" fails on this machine too.`;
    case 'not-reproduced':
      return `Not reproduced at ${short(commit)}: "${title}" passed on this machine, so the failure may depend on CI's environment or be flaky.`;
    case 'first-bad':
      return `The bisect names ${short(verdict.commit.sha)} as the first bad commit${verdict.commit.subject ? `: ${verdict.commit.subject}` : ''}.`;
    case 'stopped':
      return `The ${kind === 'bisect' ? 'bisect' : 'reproduction'} of "${title}" was stopped in the desktop app.`;
    case 'error':
      return `The desktop app could not ${kind === 'bisect' ? 'bisect' : 'reproduce'} "${title}": ${verdict.reason}`;
  }
}

export class DesktopJobs {
  private readonly jobs = new Map<string, Job>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;

  constructor(
    private readonly env: Record<string, string | undefined>,
    private readonly notify: (update: DesktopJobUpdate) => void,
    private readonly pollMs = POLL_MS,
  ) {}

  /** Whether the desktop app runs beside the instance `source` reads, so a job can go to it. */
  available(source: { client: PiwiClient | null; source: string | null }): boolean {
    return !!source.client && source.source !== 'desktop' && !!readDesktopDiscovery(this.env);
  }

  /** Build the job for a failure from the instance and pass it to the desktop app. */
  async start(source: JobSource, failure: BranchFailure, kind: DesktopJobKind): Promise<DesktopJobResult> {
    const discovery = readDesktopDiscovery(this.env);
    if (!discovery) return { ok: false, message: 'The Piwi desktop app is not running on this machine.' };
    const desktop = new PiwiClient({ serverUrl: discovery.url, apiKey: discovery.token, project: '' });
    let context;
    try {
      context = await source.client.reproduceDesktop(failure.executionId);
    } catch (e) {
      return {
        ok: false,
        message: `Could not read the failure from ${host(source.client.connection.serverUrl)}: ${String(e)}`,
      };
    }
    const { desktop: repro, bisectReason } = context;
    const commit = kind === 'bisect' ? repro.bad : repro.commit;
    if (!commit || (kind === 'bisect' && !repro.good)) {
      return {
        ok: false,
        message:
          kind === 'bisect'
            ? `This failure cannot be bisected: ${bisectReason ?? 'its last green commit is not known.'}`
            : 'This failure cannot be reproduced at its commit: the run recorded no commit.',
      };
    }
    if (repro.cases.length === 0) return { ok: false, message: 'This failure names no test to run.' };
    const request: DesktopJobRequest = {
      kind,
      commit,
      good: kind === 'bisect' ? repro.good : null,
      tests: repro.cases.slice(0, 50),
      browser: repro.browserName,
      title: failure.title,
      instanceUrl: source.client.connection.serverUrl,
      clusterId: repro.clusterId ?? failure.clusterId ?? null,
    };
    let created;
    try {
      created = await desktop.createDesktopJob(request);
    } catch (e) {
      const reason =
        e instanceof PiwiHttpError && e.status === 404 ? 'it is too old to take jobs from the editor' : String(e);
      return { ok: false, message: `The desktop app refused the job: ${reason}` };
    }
    this.jobs.set(created.id, {
      id: created.id,
      kind,
      title: failure.title,
      commit,
      clusterId: request.clusterId ?? null,
      instance: source.client,
      desktop,
      status: 'waiting',
      verdict: null,
      misses: 0,
      shared: false,
    });
    this.schedule();
    return {
      ok: true,
      jobId: created.id,
      message: created.windowOpen
        ? 'Confirm the job in the Piwi desktop app: nothing runs until you start it there.'
        : 'Open the Piwi desktop app to confirm the job: nothing runs until you start it there.',
    };
  }

  /** Record a job's verdict on the instance the failure came from, with the editor's key. */
  async share(jobId: string): Promise<ShareDesktopJobResult> {
    const job = this.jobs.get(jobId);
    if (!job || job.verdict?.kind !== 'first-bad' || job.clusterId == null) {
      return { ok: false, message: 'There is no bisect result to share.' };
    }
    const where = host(job.instance.connection.serverUrl);
    const { sha, subject, author, date } = job.verdict.commit;
    try {
      await job.instance.recordBisect(job.clusterId, { sha, subject, author, date });
    } catch (e) {
      const refused = e instanceof PiwiHttpError && (e.status === 401 || e.status === 403);
      return {
        ok: false,
        message: refused
          ? `${where} refused: recording a bisect needs a reporter or administrator key.`
          : `Could not share on ${where}: ${String(e)}`,
      };
    }
    job.shared = true;
    return {
      ok: true,
      message: `Shared on ${where}: the failure's fix plan names ${short(sha)} as the first bad commit.`,
      url: job.instance.clusterUrl(job.clusterId),
    };
  }

  dispose(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
  }

  private following(): Job[] {
    return [...this.jobs.values()].filter((j) => j.status === 'waiting' || j.status === 'running');
  }

  private schedule(): void {
    if (this.timer || this.stopped || this.following().length === 0) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.poll().finally(() => this.schedule());
    }, this.pollMs);
  }

  /** Read every job still waiting or running, and tell the client what changed. */
  async poll(): Promise<void> {
    for (const job of this.following()) {
      let state;
      try {
        state = await job.desktop.desktopJob(job.id);
        job.misses = 0;
      } catch (e) {
        const gone = e instanceof PiwiHttpError && e.status === 404;
        if (gone || ++job.misses >= MAX_MISSES) {
          this.update(job, 'gone', 'The desktop app no longer has the job: it quit, or the job expired.');
        }
        continue;
      }
      if (state.status === 'running' && job.status === 'waiting') {
        this.update(
          job,
          'running',
          `The desktop app is ${job.kind === 'bisect' ? 'bisecting' : 'reproducing'} "${job.title}".`,
        );
      } else if (state.status === 'done') {
        job.verdict = state.jobVerdict ?? { kind: 'error', reason: 'it recorded no verdict.' };
        this.update(job, 'done', verdictMessage(job.kind, job.title, job.commit, job.verdict));
      } else if (state.status === 'declined') {
        this.update(job, 'declined', `The job on "${job.title}" was declined in the desktop app.`);
      } else if (state.status === 'expired') {
        this.update(job, 'expired', `Nobody started the job on "${job.title}" in the desktop app in time.`);
      }
    }
  }

  private update(job: Job, status: DesktopJobUpdate['status'], message: string): void {
    job.status = status;
    const shareable = status === 'done' && job.verdict?.kind === 'first-bad' && job.clusterId != null;
    this.notify({
      jobId: job.id,
      kind: job.kind,
      status,
      message,
      share: shareable ? { label: `Share on ${host(job.instance.connection.serverUrl)}` } : null,
    });
  }
}
