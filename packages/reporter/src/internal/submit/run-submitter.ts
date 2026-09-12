import type { FullResult } from '@playwright/test/reporter';
import type { PiwiDashboardOptions, ShardInfo } from '../../public/options.js';
import { errorMessage } from '../support/errors.js';
import type { HttpClient } from '../transport/http-client.js';
import { HttpError } from '../transport/http-client.js';
import type { Uploader, RunPayload, ReportOptions } from './uploader.js';
import type { CrashRecovery } from '../streaming/crash-recovery.js';
import type { StreamManager } from '../streaming/stream-manager.js';
import { Logger } from '../support/logger.js';
import { computePerformanceSummary } from '../collect/step-analyzer.js';
import { resolveOverallStatus, serializeRun } from './serializer.js';
import { runUrl } from '../support/run-url.js';
import { emitRunOutputs, ciBuildUrlFromMetadata, type RunOutput } from '../support/ci-output.js';
import type { FailureLinks } from '../support/failure-links.js';
import type { CollectedTestCase, SetupStep, FilterDetails } from '../../types.js';

/**
 * Result of one rung of the submit ladder. `done` stops the ladder (the run
 * landed, or the last rung was reached); `output` carries the run identity to
 * surface to CI, and is `null` when a rung failed or the server returned no run
 * id.
 */
interface SubmitOutcome {
  done: boolean;
  output: RunOutput | null;
}

/**
 * Snapshot of everything the reporter has collected by `onEnd`, handed off to
 * the `RunSubmitter` so the reporter itself stays a thin collect-and-hand-off
 * shell.
 */
export interface CollectedRun {
  options: PiwiDashboardOptions;
  testCases: CollectedTestCase[];
  startTime: string | null;
  playwrightVersion: string | null;
  reporterVersion: string | null;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  timedOutTests: number;
  didNotRunTests: number;
  metadata: Record<string, any>;
  instanceId: string;
  shardInfo: ShardInfo | null;
  setupSteps: SetupStep[];
  isFullRun: boolean;
  filterDetails: FilterDetails | null;
}

/**
 * Owns the three-tier submit/fallback ladder:
 *
 *   1. finalize the streaming run (`/finish`) when streaming is active,
 *   2. fall back to multipart upload (`/upload`) when there are reports or
 *      traces to attach,
 *   3. fall back to plain JSON (`/submit`) as the last resort, persisting a
 *      recovery payload on total failure.
 *
 * The order and logging are identical to the pre-extraction reporter — this is
 * a move, not a redesign.
 */
export class RunSubmitter {
  /**
   * @param httpClient    HTTP client for auth resolution and the finish call.
   * @param uploader      Upload strategies (multipart + JSON).
   * @param recovery      Crash-recovery persistence.
   * @param streamManager Streaming session (may be `null` when streaming is disabled).
   * @param logger        Prefixed logger.
   * @param failureLinks  Failed tests collected during the run, for the per-failure links.
   */
  constructor(
    private readonly httpClient: HttpClient,
    private readonly uploader: Uploader,
    private readonly recovery: CrashRecovery,
    private readonly streamManager: StreamManager | null,
    private readonly logger: Logger = new Logger(),
    private readonly failureLinks: FailureLinks | null = null,
  ) {}

  /** Run the fallback ladder for a completed test run. */
  async submit(run: CollectedRun, result: FullResult): Promise<void> {
    const endTime = new Date().toISOString();
    const duration = new Date(endTime).getTime() - new Date(run.startTime!).getTime();
    const overallStatus = resolveOverallStatus(result, {
      failedTests: run.failedTests,
      timedOutTests: run.timedOutTests,
      totalTests: run.totalTests,
    });

    this.logger.info(
      `Test run completed. Status: ${overallStatus} (Playwright result.status: ${result?.status || 'undefined'})`,
    );
    this.logger.info(
      `Total: ${run.totalTests}, Passed: ${run.passedTests}, Failed: ${run.failedTests}, Skipped: ${run.skippedTests}, TimedOut: ${run.timedOutTests}, DidNotRun: ${run.didNotRunTests}`,
    );

    if (run.options.collectPerformanceMetrics) {
      run.metadata.performance = computePerformanceSummary(run.testCases);
    }

    const sm = this.streamManager;
    if (sm?.startPromise) await sm.startPromise;
    await sm?.drain();

    let auth: string | null;
    try {
      auth = sm?.auth ?? (await this.httpClient.resolveAuth(run.options));
    } catch (error) {
      this.logger.error(`Authentication failed: ${errorMessage(error)}`);
      this.saveRecovery(this.buildRunPayload(run, overallStatus, duration));
      throw error;
    }

    // A streaming session retries the recovery file when it opens; without one,
    // retry it here so a saved payload still reaches the server.
    if (!sm) await this.recovery.tryUpload(this.httpClient, auth);

    let outcome: SubmitOutcome = { done: false, output: null };

    // When buffer pressure forced test-result events out of the live stream, the
    // server is missing that detail; finalizing with `/finish` would lock it in.
    // Fall through to the batch upload, which re-sends the full run from the
    // reporter's own in-memory collection, so the dropped detail is recovered.
    if (sm?.enabled && sm?.runId != null && !sm.bufferLostResults) {
      outcome = await this.tryFinishStreaming(run, overallStatus, duration, auth);
    }

    if (!outcome.done && (this.hasReports(run) || run.options.uploadTraces)) {
      outcome = await this.tryUploadWithFiles(run, overallStatus, duration, auth);
    }

    if (!outcome.done) {
      outcome = await this.tryUploadJSON(run, overallStatus, duration, auth);
    }

    if (outcome.output) {
      // Failures that had no run id yet (batch mode, or a stream that never
      // opened) get their link lines now, ahead of the run URL.
      this.failureLinks?.printPending(outcome.output.runId);
      emitRunOutputs(outcome.output, this.logger, run.options.outputFile);
    }
  }

  /** Assemble a CI-facing run output, or `null` when the server returned no run id. */
  private buildOutput(
    runId: number | string | undefined,
    projectId: number | string | undefined,
    run: CollectedRun,
    status: string,
  ): RunOutput | null {
    if (runId == null) return null;
    return {
      runUrl: runUrl(this.httpClient.baseUrl, runId),
      runId,
      projectId,
      projectName: run.options.projectName!,
      status,
      ciBuildUrl: ciBuildUrlFromMetadata(run.metadata),
      failures: this.failureLinks?.resolve(runId) ?? [],
    };
  }

  private hasReports(run: CollectedRun): boolean {
    return !!run.options.uploadReport || (run.options.reports?.length ?? 0) > 0;
  }

  private reportOptions(run: CollectedRun): ReportOptions {
    return {
      uploadTraces: run.options.uploadTraces,
      uploadReport: run.options.uploadReport,
      reports: run.options.reports,
    };
  }

  private buildRunPayload(run: CollectedRun, status: string, duration: number): RunPayload {
    return {
      projectName: run.options.projectName!,
      projectDescription: run.options.projectDescription,
      status,
      startTime: run.startTime,
      duration,
      totalTests: run.totalTests,
      passedTests: run.passedTests,
      failedTests: run.failedTests,
      timedOutTests: run.timedOutTests,
      skippedTests: run.skippedTests,
      didNotRunTests: run.didNotRunTests,
      environment: run.options.environment,
      label: run.options.label || null,
      metadata: run.metadata,
      instanceId: run.instanceId,
      playwrightVersion: run.playwrightVersion ?? undefined,
      reporterVersion: run.reporterVersion ?? undefined,
      testCases: run.testCases,
      shardIndex: run.shardInfo?.current,
      shardTotal: run.shardInfo?.total,
      isFullRun: run.isFullRun,
      filterDetails: run.filterDetails,
    };
  }

  private async tryFinishStreaming(
    run: CollectedRun,
    overallStatus: string,
    duration: number,
    auth: string | null,
  ): Promise<SubmitOutcome> {
    const sm = this.streamManager!;
    try {
      const flakyTests = run.testCases.filter((tc) => tc.status === 'passed' && (tc.retries || 0) > 0).length;
      const durations = run.testCases.filter((tc) => tc.duration != null).map((tc) => tc.duration as number);

      await sm.uploadRemaining(run.testCases);

      const finishBody: Record<string, unknown> = {
        streamToken: sm.token,
        status: overallStatus,
        duration,
        totalTests: run.totalTests,
        passedTests: run.passedTests,
        failedTests: run.failedTests,
        timedOutTests: run.timedOutTests,
        skippedTests: run.skippedTests,
        didNotRunTests: run.didNotRunTests,
        flakyTests,
        durations,
        label: run.options.label || null,
        metadata: run.metadata,
        hasPendingUploads: this.hasReports(run),
        playwrightVersion: run.playwrightVersion ?? undefined,
        reporterVersion: run.reporterVersion ?? undefined,
        setupSteps: run.setupSteps.length > 0 ? run.setupSteps : undefined,
        isFullRun: run.isFullRun,
        filterDetails: run.filterDetails ?? null,
      };
      if (run.shardInfo) {
        finishBody.shardIndex = run.shardInfo.current;
        finishBody.shardTotal = run.shardInfo.total;
      }

      await this.httpClient.postJSON(`/api/test-runs/${sm.runId}/finish`, finishBody, auth);

      this.logger.info(`Successfully finalized streaming run #${sm.runId}`);
      this.recovery.clear();

      if (this.hasReports(run)) {
        try {
          await this.uploader.uploadReportsForStreamingRun(
            run.options.projectName!,
            sm.runId!,
            this.reportOptions(run),
            run.startTime,
            auth,
          );
        } catch (error) {
          this.logger.warn(`Failed to upload reports for streaming run: ${errorMessage(error)}`);
        }
      }
      return { done: true, output: this.buildOutput(sm.runId!, undefined, run, overallStatus) };
    } catch (error) {
      this.logger.warn(`Failed to finalize streaming run: ${errorMessage(error)}`);
      this.logger.info('Falling back to batch upload...');
      return { done: false, output: null };
    }
  }

  private async tryUploadWithFiles(
    run: CollectedRun,
    overallStatus: string,
    duration: number,
    auth: string | null,
  ): Promise<SubmitOutcome> {
    const payload = this.buildRunPayload(run, overallStatus, duration);
    try {
      const response = await this.uploader.uploadWithFiles(payload, this.reportOptions(run), auth);
      this.recovery.clear();
      return { done: true, output: this.buildOutput(response?.runId, response?.projectId, run, overallStatus) };
    } catch (error) {
      if (error instanceof HttpError && error.status === 401 && !auth) {
        this.logAuthRequired(run.options.serverUrl);
        this.saveRecovery(payload);
        throw error;
      }
      this.logger.warn(`Failed to upload with files: ${errorMessage(error)}`);
      this.logger.info('Falling back to JSON upload...');
      return { done: false, output: null };
    }
  }

  private async tryUploadJSON(
    run: CollectedRun,
    overallStatus: string,
    duration: number,
    auth: string | null,
  ): Promise<SubmitOutcome> {
    const payload = this.buildRunPayload(run, overallStatus, duration);
    try {
      const response = await this.uploader.uploadJSON(payload, auth);
      this.recovery.clear();
      return { done: true, output: this.buildOutput(response?.runId, response?.projectId, run, overallStatus) };
    } catch (error) {
      // If the server returned 401 and no auth was configured, this is a
      // configuration error — throw so the caller knows it's fatal.
      if (error instanceof HttpError && error.status === 401 && !auth) {
        this.logAuthRequired(run.options.serverUrl);
        this.saveRecovery(payload);
        throw error;
      }
      this.logger.error(`All upload methods failed: ${errorMessage(error)}`);
      this.logger.info(
        `Saved a local recovery copy — it will be uploaded automatically on your next test run. ` +
          `If this keeps happening, check that serverUrl (${run.options.serverUrl ?? 'not set'}) is correct and reachable.`,
      );
      this.saveRecovery(payload);
      // The ladder is exhausted; nothing to surface to CI.
      return { done: true, output: null };
    }
  }

  /**
   * Persist the wire-serialized payload (no raw attachments / internal fields)
   * so a later run can retry the submit.
   */
  private saveRecovery(payload: RunPayload): void {
    this.recovery.save(serializeRun(payload, { includeTestCases: true }));
  }

  /** Log one actionable line explaining how to fix a 401 caused by a missing credential. */
  private logAuthRequired(serverUrl?: string | null): void {
    this.logger.error(
      `Authentication is required by ${serverUrl ?? 'the dashboard'} but no credentials were configured. ` +
        `Create an API key (Settings → Users on the dashboard) and set the reporter's \`apiKey\` option ` +
        `or the PIWI_API_KEY environment variable.`,
    );
  }
}
