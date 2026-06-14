import * as path from "path";
import type { FullConfig, Suite, TestCase, TestResult, FullResult } from "@playwright/test/reporter";
import { resolveOptions, type DashboardReporterOptions } from "./config.js";
import { HttpClient } from "./http-client.js";
import { Uploader, type RunPayload, type ReportOptions } from "./uploader.js";
import { StreamBuffer } from "./stream-buffer.js";
import { CrashRecovery } from "./crash-recovery.js";
import { FileHandler } from "./file-handler.js";
import { MetadataCollector } from "./metadata-collector.js";
import { StreamManager } from "./stream-manager.js";
import { collectStepMetrics, computePerformanceSummary } from "./step-analyzer.js";
import { computeInstanceId, readSourceSnippet, createGlobalSetup } from "./helpers.js";

class PiwiDashboardReporter {
  private options: DashboardReporterOptions;
  private testCases: any[] = [];
  private startTime: string | null = null;
  private totalTests = 0;
  private passedTests = 0;
  private failedTests = 0;
  private skippedTests = 0;
  private timedOutTests = 0;
  private instanceId: string;
  private metadata: Record<string, any> = {};
  private enabled: boolean;

  private httpClient: HttpClient;
  private uploader: Uploader;
  private fileHandler: FileHandler;
  private metadataCollector: MetadataCollector;
  private streamManager: StreamManager | null = null;
  private recovery: CrashRecovery;

  static createGlobalSetup = createGlobalSetup;

  constructor(rawOptions: Record<string, any> = {}) {
    this.options = resolveOptions(rawOptions);
    this.enabled = !!this.options.serverUrl;
    this.instanceId = computeInstanceId(this.options.projectName!);

    this.httpClient = new HttpClient(this.options.serverUrl ?? "http://localhost:3000", this.options.verbose);
    this.fileHandler = new FileHandler();
    this.uploader = new Uploader(this.httpClient, this.fileHandler, this.options.verbose);
    this.recovery = new CrashRecovery(this.options.projectName!, this.options.verbose);
    this.metadataCollector = new MetadataCollector();

    const streamBuffer = new StreamBuffer(this.options.projectName!);
    streamBuffer.clearStale();

    if (this.options.streaming) {
      this.streamManager = new StreamManager(
        this.httpClient,
        streamBuffer,
        this.recovery,
        this.uploader,
        this.fileHandler,
        this.options,
      );
    }
  }

  onBegin(config: FullConfig, suite: Suite): void {
    if (!this.enabled) {
      console.log("[Piwi Dashboard] Not enabled — set PIWI_DASHBOARD_URL or serverUrl to enable.");
      return;
    }
    this.startTime = new Date().toISOString();
    console.log(`[Piwi Dashboard] Starting test run for project: ${this.options.projectName}`);
    this.metadata = this.metadataCollector.collect(config, suite, this.options);
    this.streamManager?.start(this.startTime, this.metadata, this.instanceId);
  }

  onTestBegin(test: TestCase, result: TestResult): void {
    const relativeFilePath = path.relative(process.cwd(), test.location.file);
    const beginEvent = {
      type: "begin",
      title: test.title,
      location: `${relativeFilePath}:${test.location.line}:${test.location.column}`,
      workerIndex: result?.workerIndex ?? (result as any)?.parallelIndex ?? null,
      browser: this.metadataCollector.getBrowserConfig(test) || undefined,
    };

    if (this.streamManager) {
      this.streamManager.queueBeginEvent(this.mapTestCase(beginEvent));
    }
  }

  onTestEnd(test: TestCase, result: TestResult): void {
    this.totalTests++;
    const relativeFilePath = path.relative(process.cwd(), test.location.file);

    const testCase: any = {
      type: "complete",
      title: test.title,
      location: `${relativeFilePath}:${test.location.line}:${test.location.column}`,
      status: result.status,
      duration: result.duration,
      error: result.error ? result.error.message : null,
      retries: result.retry,
      workerIndex: result.workerIndex ?? (result as any).parallelIndex ?? null,
      startedAt: result.startTime ? result.startTime.getTime() : null,
      attachments: result.attachments || [],
      browser: this.metadataCollector.getBrowserConfig(test) || undefined,
    };

    if (result.status === "failed" || result.status === "timedOut") {
      const snippet = readSourceSnippet(test.location.file, test.location.line, 30);
      if (snippet) testCase.testSource = snippet;
    }

    if (this.options.collectPerformanceMetrics && result.steps?.length > 0) {
      testCase.performanceMetrics = collectStepMetrics(result.steps);
    }

    if (this.options.collectPerformanceMetrics && result.attachments) {
      this.fileHandler.parsePerformanceAttachments(testCase, result.attachments);
    }

    switch (result.status) {
      case "passed":
        this.passedTests++;
        break;
      case "failed":
        this.failedTests++;
        break;
      case "skipped":
        this.skippedTests++;
        break;
      case "timedOut":
        this.timedOutTests++;
        break;
    }

    this.testCases.push(testCase);

    if (this.streamManager) {
      this.streamManager.queueEvent(this.mapTestCase(testCase));
      if (this.options.liveFileUploads) this.streamManager.scheduleLiveUpload(testCase);
    }
  }

  async onEnd(result: FullResult): Promise<void> {
    if (!this.enabled) return;
    const endTime = new Date().toISOString();
    const duration = new Date(endTime).getTime() - new Date(this.startTime!).getTime();
    const overallStatus = this.resolveOverallStatus(result);

    console.log(
      `[Piwi Dashboard] Test run completed. Status: ${overallStatus} (Playwright result.status: ${result?.status || "undefined"})`,
    );
    console.log(
      `[Piwi Dashboard] Total: ${this.totalTests}, Passed: ${this.passedTests}, Failed: ${this.failedTests}, Skipped: ${this.skippedTests}, TimedOut: ${this.timedOutTests}`,
    );

    if (this.options.collectPerformanceMetrics) {
      this.metadata.performance = computePerformanceSummary(this.testCases);
    }

    if (this.streamManager?.startPromise) await this.streamManager.startPromise;
    await this.streamManager?.drain();

    let auth: string | null;
    try {
      auth = this.streamManager?.auth ?? (await this.httpClient.resolveAuth(this.options));
    } catch (error: any) {
      console.error(`[Piwi Dashboard] Authentication failed: ${error.message}`);
      throw error;
    }

    if (this.streamManager?.enabled && this.streamManager?.runId != null) {
      if (await this.tryFinishStreaming(overallStatus, duration, auth)) return;
    }

    if (this.hasReports || this.options.uploadTraces) {
      if (await this.tryUploadWithFiles(overallStatus, duration, auth)) return;
    }

    await this.tryUploadJSON(overallStatus, duration, auth);
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private get hasReports(): boolean {
    return !!this.options.uploadReport || (this.options.reports?.length ?? 0) > 0;
  }

  private get reportOptions(): ReportOptions {
    return {
      uploadTraces: this.options.uploadTraces,
      uploadReport: this.options.uploadReport,
      reports: this.options.reports,
    };
  }

  private buildRunPayload(status: string, duration: number): RunPayload {
    return {
      projectName: this.options.projectName!,
      projectDescription: this.options.projectDescription,
      status,
      startTime: this.startTime,
      duration,
      totalTests: this.totalTests,
      passedTests: this.passedTests,
      failedTests: this.failedTests,
      skippedTests: this.skippedTests,
      environment: this.options.environment,
      metadata: this.metadata,
      instanceId: this.instanceId,
      testCases: this.testCases.map((tc) => this.mapTestCase(tc)),
    };
  }

  private resolveOverallStatus(result: FullResult): string {
    const STATUS_MAP: Record<string, string> = {
      passed: "passed",
      failed: "failed",
      timedout: "failed",
      interrupted: "failed",
    };
    if (result?.status) return STATUS_MAP[result.status] ?? "failed";
    if (this.failedTests === 0 && this.timedOutTests === 0 && this.totalTests > 0) return "passed";
    return "failed";
  }

  private mapTestCase(tc: any): any {
    const { type, ...rest } = tc;
    return {
      type,
      title: rest.title,
      location: rest.location,
      status: rest.status,
      duration: rest.duration,
      error: rest.error,
      retries: rest.retries,
      workerIndex: rest.workerIndex ?? null,
      startedAt: rest.startedAt ?? null,
      steps: rest.performanceMetrics?.steps || null,
      slowestStep: rest.performanceMetrics?.slowestStep?.title || null,
      slowestStepDuration: rest.performanceMetrics?.slowestStep?.duration || null,
      networkRequests: rest.networkRequests || null,
      webVitals: rest.webVitals || null,
      consoleLogs: rest.consoleLogs || null,
      ariaSnapshot: rest.ariaSnapshot || null,
      testSource: rest.testSource || null,
      browser: rest.browser || null,
    };
  }

  private async tryFinishStreaming(overallStatus: string, duration: number, auth: string | null): Promise<boolean> {
    const sm = this.streamManager!;
    try {
      const flakyTests = this.testCases.filter((tc) => tc.status === "passed" && (tc.retries || 0) > 0).length;
      const durations = this.testCases.filter((tc) => tc.duration != null).map((tc) => tc.duration);

      await sm.uploadRemaining(this.testCases);

      await this.httpClient.postJSON(
        `/api/test-runs/${sm.runId}/finish`,
        {
          streamToken: sm.token,
          status: overallStatus,
          duration,
          totalTests: this.totalTests,
          passedTests: this.passedTests,
          failedTests: this.failedTests,
          skippedTests: this.skippedTests,
          flakyTests,
          durations,
          metadata: this.metadata,
          hasPendingUploads: this.hasReports,
        },
        auth,
      );

      console.log(`[Piwi Dashboard] Successfully finalized streaming run #${sm.runId}`);
      this.recovery.clear();

      if (this.hasReports) {
        try {
          await this.uploader.uploadReportsForStreamingRun(
            this.options.projectName!,
            sm.runId!,
            this.reportOptions,
            this.startTime,
            auth,
          );
        } catch (error: any) {
          console.warn(`[Piwi Dashboard] Failed to upload reports for streaming run: ${error.message}`);
        }
      }
      return true;
    } catch (error: any) {
      console.warn(`[Piwi Dashboard] Failed to finalize streaming run: ${error.message}`);
      console.log("[Piwi Dashboard] Falling back to batch upload...");
      return false;
    }
  }

  private async tryUploadWithFiles(overallStatus: string, duration: number, auth: string | null): Promise<boolean> {
    try {
      await this.uploader.uploadWithFiles(this.buildRunPayload(overallStatus, duration), this.reportOptions, auth);
      this.recovery.clear();
      return true;
    } catch (error: any) {
      if (error.message?.includes("401") && !auth) throw error;
      console.warn(`[Piwi Dashboard] Failed to upload with files: ${error.message}`);
      console.log("[Piwi Dashboard] Falling back to JSON upload...");
      return false;
    }
  }

  private async tryUploadJSON(overallStatus: string, duration: number, auth: string | null): Promise<void> {
    const payload = this.buildRunPayload(overallStatus, duration);
    try {
      await this.uploader.uploadJSON(payload, auth);
      this.recovery.clear();
    } catch (error: any) {
      // If the server returned 401 and no auth was configured, this is a
      // configuration error — throw so the caller knows it's fatal.
      if (error.message?.includes("401") && !auth) throw error;
      console.error(`[Piwi Dashboard] All upload methods failed: ${error.message}`);
      this.recovery.save(payload);
    }
  }
}

export = PiwiDashboardReporter;
