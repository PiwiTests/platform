import type { FullResult } from '@playwright/test/reporter';
import type { PiwiDashboardOptions, ShardInfo } from './config.js';
import { HttpClient } from './http-client.js';
import { Uploader, type RunPayload, type ReportOptions } from './uploader.js';
import { CrashRecovery } from './crash-recovery.js';
import { StreamManager } from './stream-manager.js';
import { Logger } from './logger.js';
import { computePerformanceSummary } from './step-analyzer.js';
import { resolveOverallStatus, serializeRun } from './serializer.js';
import type { CollectedTestCase, SetupStep, FilterDetails } from './types.js';

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
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  timedOutTests: number;
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
   */
  constructor(
    private readonly httpClient: HttpClient,
    private readonly uploader: Uploader,
    private readonly recovery: CrashRecovery,
    private readonly streamManager: StreamManager | null,
    private readonly logger: Logger = new Logger(),
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
      `Total: ${run.totalTests}, Passed: ${run.passedTests}, Failed: ${run.failedTests}, Skipped: ${run.skippedTests}, TimedOut: ${run.timedOutTests}`,
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
    } catch (error: any) {
      this.logger.error(`Authentication failed: ${error.message}`);
      throw error;
    }

    if (sm?.enabled && sm?.runId != null) {
      if (await this.tryFinishStreaming(run, overallStatus, duration, auth)) return;
    }

    if (this.hasReports(run) || run.options.uploadTraces) {
      if (await this.tryUploadWithFiles(run, overallStatus, duration, auth)) return;
    }

    await this.tryUploadJSON(run, overallStatus, duration, auth);
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
      skippedTests: run.skippedTests,
      environment: run.options.environment,
      label: run.options.label || null,
      metadata: run.metadata,
      instanceId: run.instanceId,
      playwrightVersion: run.playwrightVersion ?? undefined,
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
  ): Promise<boolean> {
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
        skippedTests: run.skippedTests,
        flakyTests,
        durations,
        label: run.options.label || null,
        metadata: run.metadata,
        hasPendingUploads: this.hasReports(run),
        playwrightVersion: run.playwrightVersion ?? undefined,
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
        } catch (error: any) {
          this.logger.warn(`Failed to upload reports for streaming run: ${error.message}`);
        }
      }
      return true;
    } catch (error: any) {
      this.logger.warn(`Failed to finalize streaming run: ${error.message}`);
      this.logger.info('Falling back to batch upload...');
      return false;
    }
  }

  private async tryUploadWithFiles(
    run: CollectedRun,
    overallStatus: string,
    duration: number,
    auth: string | null,
  ): Promise<boolean> {
    try {
      await this.uploader.uploadWithFiles(
        this.buildRunPayload(run, overallStatus, duration),
        this.reportOptions(run),
        auth,
      );
      this.recovery.clear();
      return true;
    } catch (error: any) {
      if (error.message?.includes('401') && !auth) throw error;
      this.logger.warn(`Failed to upload with files: ${error.message}`);
      this.logger.info('Falling back to JSON upload...');
      return false;
    }
  }

  private async tryUploadJSON(
    run: CollectedRun,
    overallStatus: string,
    duration: number,
    auth: string | null,
  ): Promise<void> {
    const payload = this.buildRunPayload(run, overallStatus, duration);
    try {
      await this.uploader.uploadJSON(payload, auth);
      this.recovery.clear();
    } catch (error: any) {
      // If the server returned 401 and no auth was configured, this is a
      // configuration error — throw so the caller knows it's fatal.
      if (error.message?.includes('401') && !auth) throw error;
      this.logger.error(`All upload methods failed: ${error.message}`);
      // Save the wire-serialized form so the recovery file matches the
      // original submit payload (no raw attachments / internal fields).
      this.recovery.save(serializeRun(payload, { includeTestCases: true }) as Record<string, any>);
    }
  }
}
