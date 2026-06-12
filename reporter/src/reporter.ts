import * as path from "path";
import * as fs from "fs";
import { resolveOptions, type DashboardReporterOptions } from "./config.js";
import { HttpClient } from "./http-client.js";
import { Uploader } from "./uploader.js";
import { StreamBuffer } from "./stream-buffer.js";
import { CrashRecovery } from "./crash-recovery.js";
import { FileHandler } from "./file-handler.js";
import { MetadataCollector } from "./metadata-collector.js";
import { collectStepMetrics, computePerformanceSummary } from "./step-analyzer.js";
import { getSetupFilePath, computeInstanceId, createLimiter } from "./helpers.js";

class PiwiDashboardReporter {
  private options: DashboardReporterOptions;
  private testCases: any[] = [];
  private startTime: string | null = null;
  private endTime: string | null = null;
  private totalTests = 0;
  private passedTests = 0;
  private failedTests = 0;
  private skippedTests = 0;
  private timedOutTests = 0;

  private instanceId: string;
  private streamingRunId: number | null = null;
  private streamToken: string | null = null;
  private streamingEnabled = false;
  private pendingEvents: any[] = [];
  private pendingBeginEvents: any[] = [];
  private flushTimer: any = null;
  private flushPromises: Array<Promise<any>> = [];
  private liveUploadPromises: Array<Promise<void>> = [];
  private limitLiveUpload = createLimiter(2);
  private retryCount = 0;
  private retryTimer: any = null;
  private readonly maxRetryDelay = 30000;
  private metadata: Record<string, any> = {};

  private httpClient: HttpClient;
  private uploader: Uploader;
  private streamBuffer: StreamBuffer;
  private recovery: CrashRecovery;
  private fileHandler: FileHandler;
  private metadataCollector: MetadataCollector;
  private streamAuth: string | null = null;
  private streamStartPromise: Promise<void> | null = null;
  private enabled: boolean;

  constructor(rawOptions: Record<string, any> = {}) {
    this.options = resolveOptions(rawOptions);
    this.enabled = !!this.options.serverUrl;
    this.instanceId = computeInstanceId(this.options.projectName!);

    this.httpClient = new HttpClient(this.options.serverUrl ?? "http://localhost:3000", this.options.verbose);
    this.fileHandler = new FileHandler();
    this.uploader = new Uploader(this.httpClient, this.fileHandler, this.options.verbose);
    this.streamBuffer = new StreamBuffer(this.options.projectName!);
    this.recovery = new CrashRecovery(this.options.serverUrl ?? "http://localhost:3000", this.options.projectName!, this.options.verbose);
    this.metadataCollector = new MetadataCollector();

    this.streamBuffer.clearStale();
  }

  onBegin(config: any, suite: any): void {
    if (!this.enabled) {
      console.log("[Piwi Dashboard] Not enabled — set PIWI_DASHBOARD_URL or serverUrl to enable.");
      return;
    }
    this.startTime = new Date().toISOString();
    console.log(`[Piwi Dashboard] Starting test run for project: ${this.options.projectName}`);
    this.metadata = this.metadataCollector.collect(config, suite, this.options);

    if (this.options.streaming) this.startStreaming();
  }

  onTestBegin(test: any, result: any): void {
    const relativeFilePath = path.relative(process.cwd(), test.location.file);
    const browser = this.getBrowserConfig(test);
    const beginEvent = {
      type: "begin",
      title: test.title,
      location: `${relativeFilePath}:${test.location.line}:${test.location.column}`,
      workerIndex: result?.workerIndex ?? result?.parallelIndex ?? null,
      browser: browser || undefined,
    };


    if (this.streamingEnabled && this.streamingRunId) {
      this.queueStreamEvent(beginEvent);
    } else {
      this.pendingBeginEvents.push(beginEvent);
    }
  }

  onTestEnd(test: any, result: any): void {
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
      workerIndex: result.workerIndex ?? result.parallelIndex ?? null,
      startedAt: result.startTime ? result.startTime.getTime() : null,
      attachments: result.attachments || [],
    };

    const browser = this.getBrowserConfig(test);
    if (browser) testCase.browser = browser;

    if (this.options.collectPerformanceMetrics && result.steps?.length > 0) {
      testCase.performanceMetrics = collectStepMetrics(result.steps);
    }

    if (this.options.collectPerformanceMetrics && result.attachments) {
      this.attachPerformanceData(testCase, result.attachments);
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

    if (this.options.streaming) {
      this.queueStreamEvent(testCase);
      if (this.options.liveFileUploads) this.scheduleLiveFileUpload(testCase);
    }
  }

  async onEnd(result: any): Promise<void> {
    if (!this.enabled) return;
    this.endTime = new Date().toISOString();
    const duration = new Date(this.endTime).getTime() - new Date(this.startTime!).getTime();

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

    if (this.streamStartPromise) await this.streamStartPromise;

    await this.drainPendingEvents();

    let sessionCookie = this.streamAuth || null;
    if (!sessionCookie) sessionCookie = await this.resolveAuth();

    if (this.streamingEnabled && this.streamingRunId) {
      if (await this.tryFinishStreaming(overallStatus, duration, sessionCookie)) return;
    }

    const hasReports = this.options.uploadReport || (this.options.reports && this.options.reports.length > 0);
    if (this.options.uploadTraces || hasReports) {
      if (await this.tryUploadWithFiles(overallStatus, duration, sessionCookie)) return;
    }

    await this.tryUploadJSON(overallStatus, duration, sessionCookie);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private startStreaming(): void {
    const setupInfo = this.readSetupInfo();

    this.streamStartPromise = (async () => {
      try {
        if (this.options.apiKey) {
          this.streamAuth = this.options.apiKey;
        } else if (this.options.username && this.options.password) {
          this.streamAuth = await this.httpClient.login(this.options.username!, this.options.password!);
        }

        await this.recovery.tryUpload(this.httpClient, this.streamAuth);

        let response: any;
        if (setupInfo) {
          response = await this.httpClient.postJSON(
            `/api/test-runs/${setupInfo.runId}/begin`,
            {
              setupToken: setupInfo.setupToken,
              totalTests: this.totalTests,
              metadata: this.metadata,
            },
            this.streamAuth,
          );
        } else {
          response = await this.httpClient.postJSON(
            "/api/test-runs/start",
            {
              projectName: this.options.projectName,
              projectDescription: this.options.projectDescription,
              startTime: this.startTime,
              environment: this.options.environment || null,
              metadata: this.metadata,
              instanceId: this.instanceId,
            },
            this.streamAuth,
          );
        }

        if (response?.runId && response?.streamToken) {
          this.streamingRunId = response.runId;
          this.streamToken = response.streamToken;
          this.streamingEnabled = true;
          console.log(`[Piwi Dashboard] Streaming enabled. Run ID: ${response.runId}`);

          if (this.pendingBeginEvents.length > 0) {
            for (const evt of this.pendingBeginEvents) this.pendingEvents.push(evt);
            this.pendingBeginEvents = [];
            this.flushStreamEvents();
          }
        }
      } catch (error: any) {
        if (this.options.verbose)
          console.log(`[Piwi Dashboard] Streaming not available: ${error.message}. Will use batch mode.`);
        this.streamingEnabled = false;
      }
    })();
  }

  private queueStreamEvent(event: any): void {
    this.pendingEvents.push(this.mapTestCase(event));

    if (this.pendingEvents.length >= this.options.streamingBatchSize!) {
      this.flushStreamEvents();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flushStreamEvents(), this.options.streamingBatchDelay!);
    }
  }

  private flushStreamEvents(): Promise<boolean> | null {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingEvents.length === 0 || !this.streamingEnabled || !this.streamingRunId) return null;

    const events = this.pendingEvents.splice(0);
    // Never rejects: failed events are re-queued so the retry timer or the
    // end-of-run drain can resend them (the server deduplicates).
    const promise = this.httpClient
      .postJSON(
        `/api/test-runs/${this.streamingRunId}/events`,
        { streamToken: this.streamToken, testCases: events },
        this.streamAuth,
      )
      .then(
        () => {
          this.retryCount = 0;
          return true;
        },
        () => {
          this.pendingEvents = events.concat(this.pendingEvents);
          this.scheduleRetryFlush();
          return false;
        },
      );

    this.flushPromises.push(promise);
    return promise;
  }

  private scheduleLiveFileUpload(tc: any): void {
    const hasTrace = !!this.options.uploadTraces && this.fileHandler.findTraceFiles(tc).some((p) => fs.existsSync(p));
    const hasAttachments = this.fileHandler.findAllAttachments(tc).length > 0;
    if (!hasTrace && !hasAttachments) return;

    const promise = (async () => {
      if (this.streamStartPromise) await this.streamStartPromise;
      if (!this.streamingEnabled || !this.streamingRunId || !this.streamToken) return;

      // The complete event must reach the server before it can link files
      const flush = this.flushStreamEvents();
      if (flush) await flush;

      // Retry on 404: the events batch carrying this case may still be in flight
      const delays = [0, 1000, 3000];
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt]) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        try {
          await this.limitLiveUpload(() =>
            this.uploader.uploadCaseFiles(
              this.options.projectName!,
              this.streamingRunId!,
              this.streamToken!,
              tc,
              this.options.uploadTraces,
              this.streamAuth,
            ),
          );
          tc._filesUploaded = true;
          return;
        } catch (error: any) {
          const retryable = error.message?.includes("404");
          if (!retryable || attempt === delays.length - 1) {
            if (this.options.verbose)
              console.log(`[Piwi Dashboard] Live file upload failed for "${tc.title}": ${error.message}`);
            return; // The end-of-run pass retries cases that failed here
          }
        }
      }
    })();

    this.liveUploadPromises.push(promise);
  }

  private async uploadRemainingCaseFiles(): Promise<void> {
    if (this.liveUploadPromises.length > 0) {
      await Promise.allSettled(this.liveUploadPromises);
      this.liveUploadPromises = [];
    }
    if (!this.streamingEnabled || !this.streamingRunId || !this.streamToken) return;

    for (const tc of this.testCases) {
      if (tc._filesUploaded) continue;
      try {
        const uploaded = await this.uploader.uploadCaseFiles(
          this.options.projectName!,
          this.streamingRunId,
          this.streamToken,
          tc,
          this.options.uploadTraces,
          this.streamAuth,
        );
        if (uploaded) tc._filesUploaded = true;
      } catch (error: any) {
        console.warn(`[Piwi Dashboard] Failed to upload files for "${tc.title}": ${error.message}`);
      }
    }
  }

  private scheduleRetryFlush(): void {
    if (this.retryTimer) return;
    this.retryCount++;
    const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), this.maxRetryDelay);
    if (this.options.verbose)
      console.log(`[Piwi Dashboard] Will retry streaming flush in ${delay}ms (attempt ${this.retryCount})`);

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      const buffered = this.streamBuffer.load();
      if (buffered.length > 0) {
        this.streamBuffer.clear();
        this.pendingEvents = buffered.concat(this.pendingEvents);
      }
      if (this.pendingEvents.length > 0) this.flushStreamEvents();
    }, delay);
  }

  private async drainPendingEvents(): Promise<void> {
    if (!this.streamingEnabled) {
      this.pendingEvents = [];
      this.flushPromises = [];
      return;
    }

    const MAX_ATTEMPTS = 10;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (this.streamingEnabled && this.pendingEvents.length > 0) this.flushStreamEvents();
      if (this.flushPromises.length > 0) {
        await Promise.allSettled(this.flushPromises);
        this.flushPromises = [];
      }
      if (this.pendingEvents.length === 0) {
        const buffered = this.streamBuffer.load();
        if (buffered.length > 0) {
          this.pendingEvents = buffered;
          this.streamBuffer.clear();
          continue;
        }
        return;
      }
      if (this.options.verbose)
        console.warn(
          `[Piwi Dashboard] ${this.pendingEvents.length} events pending, retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`,
        );
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 10000)));
    }

    if (this.pendingEvents.length > 0) {
      this.streamBuffer.append(this.pendingEvents);
      this.pendingEvents = [];
    }
  }

  private async resolveAuth(): Promise<string | null> {
    if (this.options.apiKey) return this.options.apiKey;
    if (this.options.username && this.options.password) {
      try {
        console.log(`[Piwi Dashboard] Authenticating as ${this.options.username}...`);
        return await this.httpClient.login(this.options.username!, this.options.password!);
      } catch (error: any) {
        console.error(`[Piwi Dashboard] Authentication failed: ${error.message}`);
        throw error;
      }
    }
    return null;
  }

  private async tryFinishStreaming(
    overallStatus: string,
    duration: number,
    sessionCookie: string | null,
  ): Promise<boolean> {
    try {
      const durations = this.testCases.filter((tc: any) => tc.duration != null).map((tc: any) => tc.duration);

      const flakyTests = this.testCases.filter((tc: any) => tc.status === "passed" && (tc.retries || 0) > 0).length;

      const hasReports = this.options.uploadReport || (this.options.reports && this.options.reports.length > 0);

      // Upload remaining traces/attachments while the stream token is still
      // valid — cases uploaded live during the run are skipped.
      await this.uploadRemainingCaseFiles();

      await this.httpClient.postJSON(
        `/api/test-runs/${this.streamingRunId}/finish`,
        {
          streamToken: this.streamToken,
          status: overallStatus,
          duration,
          totalTests: this.totalTests,
          passedTests: this.passedTests,
          failedTests: this.failedTests,
          skippedTests: this.skippedTests,
          flakyTests,
          durations,
          metadata: this.metadata,
          hasPendingUploads: !!hasReports,
        },
        sessionCookie,
      );

      console.log(`[Piwi Dashboard] Successfully finalized streaming run #${this.streamingRunId}`);
      this.recovery.clear();

      if (hasReports) {
        try {
          await this.uploader.uploadReportsForStreamingRun(
            this.options.projectName!,
            this.streamingRunId,
            {
              uploadReport: this.options.uploadReport,
              reports: this.options.reports,
            },
            this.startTime,
            sessionCookie,
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

  private async tryUploadWithFiles(
    overallStatus: string,
    duration: number,
    sessionCookie: string | null,
  ): Promise<boolean> {
    try {
      await this.uploader.uploadWithFiles(
        this.options.projectName!,
        overallStatus,
        duration,
        this.startTime,
        {
          totalTests: this.totalTests,
          passedTests: this.passedTests,
          failedTests: this.failedTests,
          skippedTests: this.skippedTests,
        },
        this.options.environment,
        this.metadata,
        this.instanceId,
        this.options.projectDescription,
        this.testCases.map((tc: any) => this.mapTestCase(tc)),
        {
          uploadTraces: this.options.uploadTraces,
          uploadReport: this.options.uploadReport,
          reports: this.options.reports,
        },
        sessionCookie,
      );
      this.recovery.clear();
      return true;
    } catch (error: any) {
      if (error.message?.includes("401") && !sessionCookie) {
        throw error;
      }
      console.warn(`[Piwi Dashboard] Failed to upload with files: ${error.message}`);
      console.log("[Piwi Dashboard] Falling back to JSON upload...");
      return false;
    }
  }

  private async tryUploadJSON(overallStatus: string, duration: number, sessionCookie: string | null): Promise<void> {
    try {
      await this.uploader.uploadJSON(
        this.options.projectName!,
        overallStatus,
        duration,
        this.startTime,
        {
          totalTests: this.totalTests,
          passedTests: this.passedTests,
          failedTests: this.failedTests,
          skippedTests: this.skippedTests,
        },
        this.options.environment,
        this.metadata,
        this.instanceId,
        this.testCases.map((tc: any) => this.mapTestCase(tc)),
        this.options.projectDescription,
        sessionCookie,
      );
      this.recovery.clear();
    } catch (error: any) {
      // If the server returned 401 and no auth was configured, this is a
      // configuration error — throw so the caller knows it's fatal.
      if (error.message?.includes("401") && !sessionCookie) {
        throw error;
      }
      console.error(`[Piwi Dashboard] All upload methods failed: ${error.message}`);
      this.recovery.save({
        projectName: this.options.projectName,
        projectDescription: this.options.projectDescription,
        status: overallStatus,
        startTime: this.startTime,
        duration,
        totalTests: this.totalTests,
        passedTests: this.passedTests,
        failedTests: this.failedTests,
        skippedTests: this.skippedTests,
        environment: this.options.environment || null,
        metadata: this.metadata,
        instanceId: this.instanceId,
        testCases: this.testCases.map((tc: any) => this.mapTestCase(tc)),
      });
    }
  }

  private resolveOverallStatus(result: any): string {
    if (result?.status) {
      if (result.status === "passed") return "passed";
      if (result.status === "failed" || result.status === "timedout" || result.status === "interrupted")
        return "failed";
    } else {
      if (this.failedTests === 0 && this.timedOutTests === 0 && this.totalTests > 0) return "passed";
    }
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
      browser: rest.browser || null,
    };
  }

  private attachPerformanceData(testCase: any, attachments: any[]): void {
    const find = (name: string) => attachments.find((a: any) => a.name === name);

    const net = find("piwi-dashboard-network");
    if (net?.body) {
      try {
        testCase.networkRequests = JSON.parse(net.body.toString());
      } catch {
        /* ignore */
      }
    }

    const vitals = find("piwi-dashboard-web-vitals");
    if (vitals?.body) {
      try {
        testCase.webVitals = JSON.parse(vitals.body.toString());
      } catch {
        /* ignore */
      }
    }

    const consoleLog = find("piwi-dashboard-console");
    if (consoleLog?.body) {
      try {
        testCase.consoleLogs = JSON.parse(consoleLog.body.toString());
      } catch {
        /* ignore */
      }
    }

    const aria = find("piwi-dashboard-aria-snapshot");
    if (aria?.body) testCase.ariaSnapshot = aria.body.toString();
  }

  private readSetupInfo(): { runId: number; setupToken: string; projectName: string } | null {
    const setupFile = getSetupFilePath(this.options.projectName!);
    try {
      if (fs.existsSync(setupFile)) {
        const info = JSON.parse(fs.readFileSync(setupFile, "utf8"));
        fs.unlinkSync(setupFile);
        if (info.projectName === this.options.projectName) return info;
      }
    } catch {
      /* ignore */
    }
    return null;
  }

  private getBrowserConfig(test: any): Record<string, any> | null {
    try {
      let suite = test.parent;
      let depth = 0;
      while (suite && depth < 20) {
        depth++;
        const project = suite.project?.();
        if (project) {
          const use = project.use ?? {};
          const config: Record<string, any> = { projectName: project.name };
          if (use.browserName) config.browserName = use.browserName;
          if (use.channel) config.channel = use.channel;
          if (use.viewport) config.viewport = { width: use.viewport.width, height: use.viewport.height };
          if (use.deviceScaleFactor != null) config.deviceScaleFactor = use.deviceScaleFactor;
          if (use.isMobile != null) config.isMobile = use.isMobile;
          if (use.hasTouch != null) config.hasTouch = use.hasTouch;
          if (use.locale) config.locale = use.locale;
          if (use.timezoneId) config.timezoneId = use.timezoneId;
          if (use.geolocation) config.geolocation = { longitude: use.geolocation.longitude, latitude: use.geolocation.latitude, ...(use.geolocation.accuracy != null && { accuracy: use.geolocation.accuracy }) };
          if (use.colorScheme) config.colorScheme = use.colorScheme;
          if (use.reducedMotion) config.reducedMotion = use.reducedMotion;
          if (use.forcedColors) config.forcedColors = use.forcedColors;
          if (use.offline) config.offline = use.offline;
          if (use.bypassCSP) config.bypassCSP = use.bypassCSP;
          if (use.javaScriptEnabled === false) config.javaScriptEnabled = false;
          if (use.serviceWorkers) config.serviceWorkers = use.serviceWorkers;
          if (use.userAgent) config.userAgent = use.userAgent;
          return config;
        }
        suite = suite.parent;
      }
      return null;
    } catch (e: any) {
      return null;
    }
  }

  static createGlobalSetup(
    options?: DashboardReporterOptions,
    userSetup?: (config: any) => any,
  ): (config: any) => Promise<any> {
    return async function globalSetupFn(config: any) {
      const opts = resolveOptions(options as any);

      if (!opts.serverUrl) {
        console.log("[Piwi Dashboard] Not enabled — set PIWI_DASHBOARD_URL or serverUrl to enable.");
        if (userSetup) return userSetup(config);
        return;
      }

      const piwiReporterPath = path.resolve(__dirname, "index.js");
      const hasPiwi =
        Array.isArray(config?.reporter) &&
        config.reporter.some((r: any) => {
          if (!Array.isArray(r) || typeof r[0] !== "string") return false;
          if (r[0].toLowerCase().includes("piwi")) return true;
          try {
            return path.resolve(require.resolve(r[0])) === piwiReporterPath;
          } catch {
            return false;
          }
        });
      if (!hasPiwi) {
        if (opts.verbose)
          console.log("[Piwi Dashboard] Not reporting — Piwi is not in the Playwright reporters list.");
        if (userSetup) return userSetup(config);
        return;
      }

      const httpClient = new HttpClient(opts.serverUrl, opts.verbose);

      try {
        let auth: string | null = opts.apiKey || null;
        if (!auth && opts.username && opts.password) {
          auth = await httpClient.login(opts.username, opts.password);
        }

        const response = await httpClient.postJSON(
          "/api/test-runs/setup",
          {
            projectName: opts.projectName,
            projectDescription: opts.projectDescription,
            environment: opts.environment || null,
            startTime: new Date().toISOString(),
            instanceId: computeInstanceId(opts.projectName!),
          },
          auth,
        );

        if (response?.runId && response?.setupToken) {
          fs.writeFileSync(
            getSetupFilePath(opts.projectName!),
            JSON.stringify({
              runId: response.runId,
              setupToken: response.setupToken,
              projectName: opts.projectName,
            }),
          );
          if (opts.verbose) console.log(`[Piwi Dashboard] Global setup: initialising run #${response.runId}`);
        }
      } catch (error: any) {
        console.warn(`[Piwi Dashboard] Could not register global setup: ${error.message}`);
      }

      if (userSetup) return userSetup(config);
    };
  }
}

export = PiwiDashboardReporter;
