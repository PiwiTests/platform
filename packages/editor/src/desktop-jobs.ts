/**
 * Jobs the editor passes from the instance it reads to the desktop app running
 * on this machine: reproduce a failure at its commit, bisect it, or run a
 * flaky test's Flake Lab experiment at the commit of its latest failure. The
 * job names commits, tests and lab conditions, never code; the app shows it in
 * its window and runs nothing until the developer starts it there. The service
 * polls the app for the verdict and, asked to, shares it on the instance with
 * the editor's own key: the app never receives that key.
 */
import * as os from 'node:os';
import type {
  DesktopJobRequest,
  DesktopJobVerdict,
  FlakeLabJobPlan,
  FlakeLabJobReport,
} from '@piwitests/core/desktop-job';
import { readDesktopDiscovery } from './context.js';
import { PiwiClient, PiwiHttpError } from './piwi-client.js';
import type { BranchFailure, FlakePlan, FlakeResultsBody } from './piwi-client.js';
import type { DesktopJobKind, DesktopJobResult, DesktopJobUpdate, ShareDesktopJobResult } from './protocol.js';

/** How often a job's state is read from the app. */
const POLL_MS = 3_000;
/** Reads in a row the app may fail to answer before the job counts as gone. */
const MAX_MISSES = 5;

/** The instance a failure came from: what the context reads. */
export interface JobSource {
  client: PiwiClient;
}

/** A flaky test to run Flake Lab on, and the failure it was offered on, if any. */
export interface LabTarget {
  testCaseId: number;
  title?: string | null;
  clusterId?: number | null;
}

interface Job {
  id: string;
  kind: DesktopJobKind;
  title: string;
  commit: string;
  clusterId: number | null;
  /** The experiment a Flake Lab job runs, as the instance recorded it. */
  plan: FlakeLabJobPlan | null;
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

/** How a job reads in a sentence: what it is, and what the app does while it runs. */
const JOB_WORDS: Record<DesktopJobKind, { noun: string; verb: string; running: string }> = {
  reproduce: { noun: 'reproduction', verb: 'reproduce', running: 'reproducing' },
  bisect: { noun: 'bisect', verb: 'bisect', running: 'bisecting' },
  'flake-lab': { noun: 'Flake Lab run', verb: 'run Flake Lab on', running: 'running Flake Lab on' },
};

/** The sentence a Flake Lab job's results read as, with the reproducing arm's label from the plan. */
function labMessage(title: string, commit: string, report: FlakeLabJobReport, plan: FlakeLabJobPlan | null): string {
  const control = report.arms.find((a) => a.id === 'control');
  const against = control ? ` (control ${control.matchingFailures} of ${control.runs})` : '';
  const at = short(report.commit ?? commit);
  if (report.verdict === 'reproduced') {
    const arm = report.arms.find((a) => a.id === report.reproducingArm);
    const label = plan && [...plan.arms, plan.combined].find((a) => a?.id === report.reproducingArm)?.label;
    const measured = arm ? `: ${arm.matchingFailures} of ${arm.runs} runs${label ? ` under ${label}` : ''}` : '';
    return `Flake Lab reproduced "${title}" at ${at}${measured} failed as in CI${against}.`;
  }
  if (report.verdict === 'amplified') {
    return `Flake Lab made "${title}" fail more often at ${at}, without reproducing it${against}.`;
  }
  return `Flake Lab did not reproduce "${title}" at ${at}: no condition made it fail as in CI${against}.`;
}

/** The sentence a job's verdict reads as. */
export function verdictMessage(
  kind: DesktopJobKind,
  title: string,
  commit: string,
  verdict: DesktopJobVerdict,
  plan: FlakeLabJobPlan | null = null,
): string {
  switch (verdict.kind) {
    case 'reproduced':
      return `Reproduced at ${short(commit)}: "${title}" fails on this machine too.`;
    case 'not-reproduced':
      return `Not reproduced at ${short(commit)}: "${title}" passed on this machine, so the failure may depend on CI's environment or be flaky.`;
    case 'first-bad':
      return `The bisect names ${short(verdict.commit.sha)} as the first bad commit${verdict.commit.subject ? `: ${verdict.commit.subject}` : ''}.`;
    case 'lab':
      return labMessage(title, commit, verdict.report, plan);
    case 'stopped':
      return `The ${JOB_WORDS[kind].noun} of "${title}" was stopped in the desktop app.`;
    case 'error':
      return `The desktop app could not ${JOB_WORDS[kind].verb} "${title}": ${verdict.reason}`;
  }
}

/**
 * The body that records a Flake Lab job's results on the instance: each arm's
 * label and conditions from the plan the instance recorded, its counts from the
 * desktop app. An arm the plan does not hold is left out.
 */
export function labResults(plan: FlakeLabJobPlan, report: FlakeLabJobReport): FlakeResultsBody {
  const planned = new Map(
    [plan.control, ...plan.arms, ...(plan.combined ? [plan.combined] : [])].map((a) => [a.id, a]),
  );
  return {
    experimentId: plan.experimentId ?? '',
    commit: report.commit,
    playwrightProject: plan.test.project,
    arms: report.arms.flatMap((count) => {
      const arm = planned.get(count.id);
      if (!arm) return [];
      return [
        {
          id: arm.id,
          label: arm.label,
          suspectId: arm.suspectId,
          conditions: arm.conditions,
          runs: count.runs,
          matchingFailures: count.matchingFailures,
          otherFailures: count.otherFailures,
          discardedRounds: count.discardedRounds,
          stoppedEarly: count.stoppedEarly,
        },
      ];
    }),
  };
}

/** The plan as a job carries it: the fields the lab runs, without the suspects the command line prints. */
function jobPlan(plan: FlakePlan): FlakeLabJobPlan {
  return {
    version: 1,
    experimentId: plan.experimentId,
    kind: 'reproduce',
    projectId: plan.projectId,
    testCaseId: plan.testCaseId,
    test: plan.test,
    displayTitle: plan.displayTitle,
    windowDays: plan.windowDays,
    failures: plan.failures,
    passes: plan.passes,
    failureCommit: plan.failureCommit,
    medianDurationMs: plan.medianDurationMs,
    errorSignatures: plan.errorSignatures,
    suspects: [],
    control: plan.control,
    arms: plan.arms,
    combined: plan.combined,
    verifies: null,
  };
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

  private desktop(): PiwiClient | null {
    const discovery = readDesktopDiscovery(this.env);
    return discovery ? new PiwiClient({ serverUrl: discovery.url, apiKey: discovery.token, project: '' }) : null;
  }

  /** Build the job for a failure from the instance and pass it to the desktop app. */
  async start(
    source: JobSource,
    failure: BranchFailure,
    kind: Exclude<DesktopJobKind, 'flake-lab'>,
  ): Promise<DesktopJobResult> {
    const desktop = this.desktop();
    if (!desktop) return { ok: false, message: 'The Piwi desktop app is not running on this machine.' };
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
    return this.submit(source, desktop, request, failure.title, null);
  }

  /**
   * Read a flaky test's reproduce plan from the instance, recorded as an
   * experiment run from this machine's desktop app, and pass it to the app,
   * which runs it at the commit of the test's latest failure.
   */
  async startFlakeLab(source: JobSource, target: LabTarget): Promise<DesktopJobResult> {
    const desktop = this.desktop();
    if (!desktop) return { ok: false, message: 'The Piwi desktop app is not running on this machine.' };
    const where = host(source.client.connection.serverUrl);
    let plan: FlakePlan;
    try {
      plan = await source.client.flakePlan(target.testCaseId, os.hostname());
    } catch (e) {
      const refused = e instanceof PiwiHttpError && (e.status === 401 || e.status === 403);
      return {
        ok: false,
        message: refused
          ? `${where} refused: running Flake Lab needs a reporter or administrator key.`
          : `Could not read the test's Flake Lab plan from ${where}: ${String(e)}`,
      };
    }
    const commit = plan.failureCommit?.toLowerCase() ?? null;
    if (!commit || !/^[0-9a-f]{7,40}$/.test(commit)) {
      return {
        ok: false,
        message:
          "The test's latest failure recorded no commit, so the desktop app has nothing to check out: run Reproduce this flake in your checkout instead.",
      };
    }
    if (plan.arms.length === 0) {
      return {
        ok: false,
        message: 'No suspect of this test has a condition to test, so Flake Lab has nothing to run.',
      };
    }
    const title = target.title || plan.displayTitle || plan.test.title;
    const request: DesktopJobRequest = {
      kind: 'flake-lab',
      commit,
      plan: jobPlan(plan),
      title,
      instanceUrl: source.client.connection.serverUrl,
      clusterId: target.clusterId ?? null,
    };
    return this.submit(source, desktop, request, title, request.plan!);
  }

  /** Post a job to the desktop app and follow it. */
  private async submit(
    source: JobSource,
    desktop: PiwiClient,
    request: DesktopJobRequest,
    title: string,
    plan: FlakeLabJobPlan | null,
  ): Promise<DesktopJobResult> {
    let created;
    try {
      created = await desktop.createDesktopJob(request);
    } catch (e) {
      const tooOld =
        e instanceof PiwiHttpError && (e.status === 404 || (e.status === 400 && request.kind === 'flake-lab'));
      const reason = tooOld
        ? `it is too old to take ${request.kind === 'flake-lab' ? 'Flake Lab jobs' : 'jobs'} from the editor`
        : String(e);
      return { ok: false, message: `The desktop app refused the job: ${reason}` };
    }
    this.jobs.set(created.id, {
      id: created.id,
      kind: request.kind,
      title,
      commit: request.commit,
      clusterId: request.clusterId ?? null,
      plan,
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

  /** Record a job's verdict on the instance the job came from, with the editor's key. */
  async share(jobId: string): Promise<ShareDesktopJobResult> {
    const job = this.jobs.get(jobId);
    if (job?.kind === 'flake-lab') return this.shareLab(job);
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

  /** Record a Flake Lab job's results on the experiment the instance recorded for it. */
  private async shareLab(job: Job): Promise<ShareDesktopJobResult> {
    const plan = job.plan;
    if (job.verdict?.kind !== 'lab' || !plan?.experimentId) {
      return { ok: false, message: 'There are no Flake Lab results to share.' };
    }
    const where = host(job.instance.connection.serverUrl);
    const url = job.instance.flakinessUrl(plan.testCaseId);
    if (job.shared) return { ok: true, message: `Already shared on ${where}.`, url };
    try {
      await job.instance.recordFlakeResults(plan.projectId, labResults(plan, job.verdict.report));
    } catch (e) {
      const status = e instanceof PiwiHttpError ? e.status : null;
      return {
        ok: false,
        message:
          status === 401 || status === 403
            ? `${where} refused: recording lab results needs a reporter or administrator key.`
            : status === 409
              ? `${where} already holds this experiment's results.`
              : `Could not share on ${where}: ${String(e)}`,
      };
    }
    job.shared = true;
    return { ok: true, message: `Shared on ${where}: the test's Flakiness tab shows the experiment.`, url };
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
        this.update(job, 'running', `The desktop app is ${JOB_WORDS[job.kind].running} "${job.title}".`);
      } else if (state.status === 'done') {
        job.verdict = state.jobVerdict ?? { kind: 'error', reason: 'it recorded no verdict.' };
        this.update(job, 'done', verdictMessage(job.kind, job.title, job.commit, job.verdict, job.plan));
      } else if (state.status === 'declined') {
        this.update(job, 'declined', `The job on "${job.title}" was declined in the desktop app.`);
      } else if (state.status === 'expired') {
        this.update(job, 'expired', `Nobody started the job on "${job.title}" in the desktop app in time.`);
      }
    }
  }

  private shareable(job: Job): boolean {
    if (job.status !== 'done') return false;
    if (job.kind === 'flake-lab') return job.verdict?.kind === 'lab' && !!job.plan?.experimentId;
    return job.verdict?.kind === 'first-bad' && job.clusterId != null;
  }

  private update(job: Job, status: DesktopJobUpdate['status'], message: string): void {
    job.status = status;
    this.notify({
      jobId: job.id,
      kind: job.kind,
      status,
      message,
      share: this.shareable(job) ? { label: `Share on ${host(job.instance.connection.serverUrl)}` } : null,
    });
  }
}
