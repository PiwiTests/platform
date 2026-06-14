import * as fs from "fs";
import type { DashboardReporterOptions } from "./config.js";
import { HttpClient } from "./http-client.js";
import { StreamBuffer } from "./stream-buffer.js";
import { CrashRecovery } from "./crash-recovery.js";
import { Uploader } from "./uploader.js";
import { FileHandler } from "./file-handler.js";
import { createLimiter, readSetupInfo } from "./helpers.js";

export class StreamManager {
  private pendingEvents: any[] = [];
  private pendingBeginEvents: any[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromises: Array<Promise<boolean>> = [];
  private liveUploadPromises: Array<Promise<void>> = [];
  private readonly limitLiveUpload = createLimiter(2);
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxRetryDelay = 30000;

  private _enabled = false;
  private _runId: number | null = null;
  private _token: string | null = null;
  private _auth: string | null = null;
  private _startPromise: Promise<void> | null = null;

  get enabled(): boolean {
    return this._enabled;
  }
  get runId(): number | null {
    return this._runId;
  }
  get token(): string | null {
    return this._token;
  }
  get auth(): string | null {
    return this._auth;
  }
  get startPromise(): Promise<void> | null {
    return this._startPromise;
  }

  constructor(
    private readonly httpClient: HttpClient,
    private readonly streamBuffer: StreamBuffer,
    private readonly recovery: CrashRecovery,
    private readonly uploader: Uploader,
    private readonly fileHandler: FileHandler,
    private readonly options: DashboardReporterOptions,
  ) {}

  start(startTime: string, metadata: Record<string, any>, instanceId: string): void {
    this._startPromise = this._doStart(startTime, metadata, instanceId);
  }

  private async _doStart(startTime: string, metadata: Record<string, any>, instanceId: string): Promise<void> {
    const setupInfo = readSetupInfo(this.options.projectName!);

    try {
      this._auth = await this.httpClient.resolveAuth(this.options);
      await this.recovery.tryUpload(this.httpClient, this._auth);

      let response: any;
      if (setupInfo) {
        response = await this.httpClient.postJSON(
          `/api/test-runs/${setupInfo.runId}/begin`,
          { setupToken: setupInfo.setupToken, totalTests: 0, metadata },
          this._auth,
        );
      } else {
        response = await this.httpClient.postJSON(
          "/api/test-runs/start",
          {
            projectName: this.options.projectName,
            projectDescription: this.options.projectDescription,
            startTime,
            environment: this.options.environment || null,
            metadata,
            instanceId,
          },
          this._auth,
        );
      }

      if (response?.runId && response?.streamToken) {
        this._runId = response.runId;
        this._token = response.streamToken;
        this._enabled = true;
        console.log(`[Piwi Dashboard] Streaming enabled. Run ID: ${response.runId}`);

        if (this.pendingBeginEvents.length > 0) {
          this.pendingEvents = [...this.pendingBeginEvents, ...this.pendingEvents];
          this.pendingBeginEvents = [];
          this.flush();
        }
      }
    } catch (error: any) {
      if (this.options.verbose) {
        console.log(`[Piwi Dashboard] Streaming not available: ${error.message}. Will use batch mode.`);
      }
      this._enabled = false;
    }
  }

  // Queues a begin event; held in a pre-start buffer until the stream is open,
  // then prepended to the main queue so it arrives before the matching complete event.
  queueBeginEvent(event: any): void {
    if (this._enabled && this._runId) {
      this.queueEvent(event);
    } else {
      this.pendingBeginEvents.push(event);
    }
  }

  queueEvent(event: any): void {
    this.pendingEvents.push(event);

    if (this.pendingEvents.length >= this.options.streamingBatchSize!) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.options.streamingBatchDelay!);
    }
  }

  flush(): Promise<boolean> | null {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.pendingEvents.length === 0 || !this._enabled || !this._runId) return null;

    const events = this.pendingEvents.splice(0);
    // Never rejects: failed events are re-queued so the retry timer or the
    // end-of-run drain can resend them (the server deduplicates).
    const promise = this.httpClient
      .postJSON(
        `/api/test-runs/${this._runId}/events`,
        { streamToken: this._token, testCases: events },
        this._auth,
      )
      .then(
        () => {
          this.retryCount = 0;
          return true;
        },
        () => {
          this.pendingEvents = events.concat(this.pendingEvents);
          this.scheduleRetry();
          return false;
        },
      );

    this.flushPromises.push(promise);
    return promise;
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryCount++;
    const delay = Math.min(1000 * Math.pow(2, this.retryCount - 1), this.maxRetryDelay);
    if (this.options.verbose) {
      console.log(`[Piwi Dashboard] Will retry streaming flush in ${delay}ms (attempt ${this.retryCount})`);
    }

    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      const buffered = this.streamBuffer.load();
      if (buffered.length > 0) {
        this.streamBuffer.clear();
        this.pendingEvents = buffered.concat(this.pendingEvents);
      }
      if (this.pendingEvents.length > 0) this.flush();
    }, delay);
  }

  async drain(): Promise<void> {
    if (!this._enabled) {
      this.pendingEvents = [];
      this.flushPromises = [];
      return;
    }

    const MAX_ATTEMPTS = 10;
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (this._enabled && this.pendingEvents.length > 0) this.flush();
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
      if (this.options.verbose) {
        console.warn(
          `[Piwi Dashboard] ${this.pendingEvents.length} events pending, retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 10000)));
    }

    if (this.pendingEvents.length > 0) {
      this.streamBuffer.append(this.pendingEvents);
      this.pendingEvents = [];
    }
  }

  scheduleLiveUpload(tc: any): void {
    const hasTrace = !!this.options.uploadTraces && this.fileHandler.findTraceFiles(tc).some((p) => fs.existsSync(p));
    const hasAttachments = this.fileHandler.findAllAttachments(tc).length > 0;
    if (!hasTrace && !hasAttachments) return;

    const promise = (async () => {
      if (this._startPromise) await this._startPromise;
      if (!this._enabled || !this._runId || !this._token) return;

      // The complete event must reach the server before it can link files
      const flush = this.flush();
      if (flush) await flush;

      // Retry on 404: the events batch carrying this case may still be in flight
      const delays = [0, 1000, 3000];
      for (let attempt = 0; attempt < delays.length; attempt++) {
        if (delays[attempt]) await new Promise((resolve) => setTimeout(resolve, delays[attempt]));
        try {
          await this.limitLiveUpload(() =>
            this.uploader.uploadCaseFiles(
              this.options.projectName!,
              this._runId!,
              this._token!,
              tc,
              this.options.uploadTraces,
              this._auth,
            ),
          );
          tc._filesUploaded = true;
          return;
        } catch (error: any) {
          const retryable = error.message?.includes("404");
          if (!retryable || attempt === delays.length - 1) {
            if (this.options.verbose) {
              console.log(`[Piwi Dashboard] Live file upload failed for "${tc.title}": ${error.message}`);
            }
            return; // The end-of-run pass retries cases that failed here
          }
        }
      }
    })();

    this.liveUploadPromises.push(promise);
  }

  async uploadRemaining(testCases: any[]): Promise<void> {
    if (this.liveUploadPromises.length > 0) {
      await Promise.allSettled(this.liveUploadPromises);
      this.liveUploadPromises = [];
    }
    if (!this._enabled || !this._runId || !this._token) return;

    for (const tc of testCases) {
      if (tc._filesUploaded) continue;
      try {
        const uploaded = await this.uploader.uploadCaseFiles(
          this.options.projectName!,
          this._runId,
          this._token,
          tc,
          this.options.uploadTraces,
          this._auth,
        );
        if (uploaded) tc._filesUploaded = true;
      } catch (error: any) {
        console.warn(`[Piwi Dashboard] Failed to upload files for "${tc.title}": ${error.message}`);
      }
    }
  }
}
