import * as fs from 'node:fs';
import { errorMessage } from '../support/errors.js';
import type { PiwiDashboardOptions, ShardInfo } from '../../public/options.js';
import type { HttpClient } from '../transport/http-client.js';
import { HttpError } from '../transport/http-client.js';
import type { StreamBuffer } from './stream-buffer.js';
import type { CrashRecovery } from './crash-recovery.js';
import type { Uploader } from '../submit/uploader.js';
import type { FileHandler } from '../files/file-handler.js';
import { Logger } from '../support/logger.js';
import { createLimiter } from '../support/limiter.js';
import { readSetupInfo } from '../support/setup-file.js';
import type { CollectedTestCase, StreamEvent, FilterDetails } from '../../types.js';

/**
 * Manages the streaming protocol: queues events (begin / complete), flushes
 * them in batches, schedules retries on failure, and handles per-test-case
 * live file uploads.
 */
export class StreamManager {
  private pendingEvents: StreamEvent[] = [];
  private pendingBeginEvents: StreamEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private flushPromises: Array<Promise<boolean>> = [];
  private liveUploadPromises: Array<Promise<void>> = [];
  private readonly limitLiveUpload = createLimiter(2);
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly maxRetryDelay = 30000;
  /**
   * Idle heartbeat: while the run is open but no events are flowing (e.g. a single
   * long test, or `beforeAll` setup), a periodic ping keeps the server's activity
   * timestamp fresh so the stale-run reaper can tell a live run from a crashed one.
   * The interval must stay well below the server's stale timeout.
   */
  private heartbeatTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatStopped = false;
  private lastActivityAt = 0;
  private readonly heartbeatInterval = 15000;
  /** Tracks cases whose files have already been uploaded live, so `uploadRemaining` can skip them. */
  private readonly uploadedCaseFiles = new WeakSet<CollectedTestCase>();

  private _enabled = false;
  private _runId: number | null = null;
  private _token: string | null = null;
  private _auth: string | null = null;
  private _startPromise: Promise<void> | null = null;

  /** Whether the streaming session is active */
  get enabled(): boolean {
    return this._enabled;
  }
  /** Server-assigned run ID (`null` until the stream opens) */
  get runId(): number | null {
    return this._runId;
  }
  /** Stream authentication token (`null` until the stream opens) */
  get token(): string | null {
    return this._token;
  }
  /** Resolved auth string (API key or session cookie) used in stream requests */
  get auth(): string | null {
    return this._auth;
  }
  /** Promise that resolves when the stream has been fully initialised */
  get startPromise(): Promise<void> | null {
    return this._startPromise;
  }

  /**
   * @param httpClient  HTTP client for server communication.
   * @param streamBuffer On-disk buffer for crash-safe event persistence.
   * @param recovery    Crash-recovery handler for uploading stale payloads on startup.
   * @param uploader    Uploader for per-test-case file uploads.
   * @param fileHandler File-discovery helper for finding traces and attachments.
   * @param options     Piwi Dashboard reporter options.
   * @param logger      Prefixed logger.
   */
  constructor(
    private readonly httpClient: HttpClient,
    private readonly streamBuffer: StreamBuffer,
    private readonly recovery: CrashRecovery,
    private readonly uploader: Uploader,
    private readonly fileHandler: FileHandler,
    private readonly options: PiwiDashboardOptions,
    private readonly logger: Logger = new Logger(),
  ) {}

  /** Begin the streaming session after `onBegin` fires. Non-blocking — the actual handshake runs asynchronously. */
  start(
    startTime: string,
    metadata: Record<string, any>,
    instanceId: string,
    playwrightVersion?: string | null,
    shardInfo?: ShardInfo | null,
    isFullRun?: boolean,
    filterDetails?: FilterDetails | null,
  ): void {
    this._startPromise = this._doStart(
      startTime,
      metadata,
      instanceId,
      playwrightVersion,
      shardInfo,
      isFullRun,
      filterDetails,
    );
  }

  private async _doStart(
    startTime: string,
    metadata: Record<string, any>,
    instanceId: string,
    playwrightVersion?: string | null,
    shardInfo?: ShardInfo | null,
    isFullRun?: boolean,
    filterDetails?: FilterDetails | null,
  ): Promise<void> {
    const setupInfo = readSetupInfo(this.options.projectName!);

    try {
      this._auth = await this.httpClient.resolveAuth(this.options);
      await this.recovery.tryUpload(this.httpClient, this._auth);

      let response: any;
      const shardIndex = shardInfo?.current;
      const shardTotal = shardInfo?.total;

      if (setupInfo) {
        try {
          response = await this.httpClient.postJSON(
            `/api/test-runs/${setupInfo.runId}/begin`,
            {
              setupToken: setupInfo.setupToken,
              totalTests: 0,
              metadata,
              playwrightVersion,
              shardIndex,
              shardTotal,
              isFullRun,
              filterDetails,
            },
            this._auth,
          );
        } catch (error) {
          // Stale setupInfo — the run was cancelled (e.g. by crash recovery submit).
          // Fall back to creating a fresh run instead of silently disabling streaming.
          if (!(error instanceof HttpError && error.status === 409)) throw error;
          this.logger.debug(`Setup info expired, creating fresh run...`);
          response = await this.httpClient.postJSON(
            '/api/test-runs/start',
            {
              projectName: this.options.projectName,
              projectDescription: this.options.projectDescription,
              startTime,
              environment: this.options.environment || null,
              label: this.options.label || null,
              metadata,
              instanceId,
              playwrightVersion,
              shardIndex,
              shardTotal,
              isFullRun,
              filterDetails,
            },
            this._auth,
          );
        }
      } else {
        response = await this.httpClient.postJSON(
          '/api/test-runs/start',
          {
            projectName: this.options.projectName,
            projectDescription: this.options.projectDescription,
            startTime,
            environment: this.options.environment || null,
            label: this.options.label || null,
            metadata,
            instanceId,
            playwrightVersion,
            shardIndex,
            shardTotal,
            isFullRun,
            filterDetails,
          },
          this._auth,
        );
      }

      if (response?.runId && response?.streamToken) {
        this._runId = response.runId;
        this._token = response.streamToken;
        this._enabled = true;
        this.logger.info(`Streaming enabled. Run ID: ${response.runId}`);
        this.lastActivityAt = Date.now();
        this.scheduleHeartbeat();

        if (this.pendingBeginEvents.length > 0) {
          this.pendingEvents = [...this.pendingBeginEvents, ...this.pendingEvents];
          this.pendingBeginEvents = [];
          this.flush();
        }
      }
    } catch (error) {
      this.logger.debug(`Streaming not available: ${errorMessage(error)}. Will use batch mode.`);
      this._enabled = false;
    }
  }

  // Queues a begin event; held in a pre-start buffer until the stream is open,
  // then prepended to the main queue so it arrives before the matching complete event.
  /** Queue a test-case `begin` event. Held in a pre-start buffer if the stream is not yet open, then prepended so it arrives before the matching `complete` event. */
  queueBeginEvent(event: StreamEvent): void {
    if (this._enabled && this._runId) {
      this.queueEvent(event);
    } else {
      this.pendingBeginEvents.push(event);
    }
  }

  /** Queue a test-case event. Triggers an immediate flush when the batch size is reached, otherwise schedules a timer-based flush. */
  queueEvent(event: StreamEvent): void {
    this.pendingEvents.push(event);

    if (this.pendingEvents.length >= this.options.streamingBatchSize!) {
      this.flush();
    } else if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => this.flush(), this.options.streamingBatchDelay!);
    }
  }

  /** Flush all pending events to the server. Returns a promise that resolves to `true` on success or `false` on failure (events are re-queued for retry). */
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
      .postJSON(`/api/test-runs/${this._runId}/events`, { streamToken: this._token, testCases: events }, this._auth)
      .then(
        () => {
          this.retryCount = 0;
          this.lastActivityAt = Date.now();
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
    this.logger.debug(`Will retry streaming flush in ${delay}ms (attempt ${this.retryCount})`);

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

  // Schedule the next idle heartbeat. Self-rescheduling; cleared by stopHeartbeat.
  private scheduleHeartbeat(): void {
    if (this.heartbeatStopped || this.heartbeatTimer) return;
    this.heartbeatTimer = setTimeout(() => {
      this.heartbeatTimer = null;
      void this.sendHeartbeat();
    }, this.heartbeatInterval);
  }

  // Ping the server only when the run has actually been idle. Real event traffic
  // already bumps the server's activity timestamp, so a recent flush (or pending
  // events about to flush) makes the ping redundant — skip it and reschedule.
  private async sendHeartbeat(): Promise<void> {
    if (this.heartbeatStopped || !this._enabled || !this._runId || !this._token) return;

    const idleFor = Date.now() - this.lastActivityAt;
    if (idleFor < this.heartbeatInterval || this.pendingEvents.length > 0) {
      this.scheduleHeartbeat();
      return;
    }

    try {
      await this.httpClient.postJSON(
        `/api/test-runs/${this._runId}/heartbeat`,
        { streamToken: this._token },
        this._auth,
      );
      this.lastActivityAt = Date.now();
    } catch (error) {
      this.logger.debug(`Heartbeat failed: ${errorMessage(error)}`);
    }
    this.scheduleHeartbeat();
  }

  /** Stop the idle heartbeat permanently (called when the run is wrapping up). */
  private stopHeartbeat(): void {
    this.heartbeatStopped = true;
    if (this.heartbeatTimer) {
      clearTimeout(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  /** Drain all pending and buffered events before the run finishes. Retries up to 10 times with exponential back-off. */
  async drain(): Promise<void> {
    this.stopHeartbeat();
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
      this.logger.debugError(
        `${this.pendingEvents.length} events pending, retrying (attempt ${attempt + 1}/${MAX_ATTEMPTS})...`,
      );
      await new Promise((resolve) => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 10000)));
    }

    if (this.pendingEvents.length > 0) {
      this.streamBuffer.append(this.pendingEvents);
      this.pendingEvents = [];
    }
  }

  /** Schedule a live upload of trace and attachment files for a test case. Skips cases with no files. Concurrency is limited to 2 simultaneous uploads. */
  scheduleLiveUpload(tc: CollectedTestCase): void {
    const hasTrace = !!this.options.uploadTraces && this.fileHandler.findTraceFiles(tc).some((p) => fs.existsSync(p));
    const hasAttachments = this.fileHandler.findAllAttachments(tc).length > 0;
    if (!hasTrace && !hasAttachments) return;

    const promise = (async () => {
      if (this._startPromise) await this._startPromise;
      if (!this._enabled || !this._runId || !this._token) return;

      // The complete event must reach the server before it can link files.
      // queueEvent may have already triggered a batch-size flush that took all
      // pending events, making our flush() return null.  Wait for any in-flight
      // flush promises first, then try to flush remaining events.
      if (this.flushPromises.length > 0) {
        await Promise.allSettled(this.flushPromises);
      }
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
          this.uploadedCaseFiles.add(tc);
          return;
        } catch (error) {
          const retryable = error instanceof HttpError && error.status === 404;
          if (!retryable || attempt === delays.length - 1) {
            this.logger.debug(`Live file upload failed for "${tc.title}": ${errorMessage(error)}`);
            return; // The end-of-run pass retries cases that failed here
          }
        }
      }
    })();

    this.liveUploadPromises.push(promise);
  }

  /** Wait for all live uploads to settle, then upload files for any test cases that weren't uploaded live */
  async uploadRemaining(testCases: CollectedTestCase[]): Promise<void> {
    if (this.liveUploadPromises.length > 0) {
      await Promise.allSettled(this.liveUploadPromises);
      this.liveUploadPromises = [];
    }
    if (!this._enabled || !this._runId || !this._token) return;

    for (const tc of testCases) {
      if (this.uploadedCaseFiles.has(tc)) continue;
      try {
        const uploaded = await this.uploader.uploadCaseFiles(
          this.options.projectName!,
          this._runId,
          this._token,
          tc,
          this.options.uploadTraces,
          this._auth,
        );
        if (uploaded) this.uploadedCaseFiles.add(tc);
      } catch (error) {
        this.logger.warn(`Failed to upload files for "${tc.title}": ${errorMessage(error)}`);
      }
    }
  }
}
