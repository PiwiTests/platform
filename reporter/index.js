const path = require('path');
const fs = require('fs');
const os = require('os');
const crypto = require('crypto');
const FormData = require('form-data');
const { collectMetadata } = require('./lib/metadata');
const { collectStepMetrics, computePerformanceSummary } = require('./lib/steps');
const { loginUser, postJSON, postFormData } = require('./lib/upload');
const {
  findHTMLReportDirectory,
  findReportDirectory,
  compressReportDirectory,
  findTraceFiles,
  findAllAttachments,
  computeTraceHashes,
  DEFAULT_REPORT_DIRS
} = require('./lib/files');

/**
 * Piwi Dashboard Reporter
 * Sends test results to a Piwi Dashboard server
 */
class PiwiDashboardReporter {
  constructor(options = {}) {
    this.options = {
      serverUrl: options.serverUrl || 'http://localhost:3000',
      projectName: options.projectName || 'default-project',
      uploadTraces: options.uploadTraces !== false, // default true
      uploadReport: options.uploadReport !== false, // default true
      collectScmInfo: options.collectScmInfo !== false, // default true
      collectCiInfo: options.collectCiInfo !== false, // default true
      collectPerformanceMetrics: options.collectPerformanceMetrics !== false, // default true
      streaming: options.streaming !== false, // default true - enable live streaming
      streamingBatchSize: options.streamingBatchSize || 5, // send events in batches of N
      streamingBatchDelay: options.streamingBatchDelay || 2000, // or every N ms
      username: options.username || null,
      password: options.password || null,
      apiKey: options.apiKey || null,
      ...options
    };

    this.testCases = [];
    this.startTime = null;
    this.endTime = null;
    this.totalTests = 0;
    this.passedTests = 0;
    this.failedTests = 0;
    this.skippedTests = 0;
    this.timedOutTests = 0;

    this.instanceId = computeInstanceId(this.options.projectName);

    // Streaming state
    this.streamingRunId = null;
    this.streamToken = null;
    this.streamingEnabled = false;
    this.pendingEvents = [];
    this.pendingBeginEvents = [];
    this.flushTimer = null;
    this.flushPromises = [];

    // Retry state for server-down resilience
    this._retryCount = 0;
    this._retryTimer = null;
    this._maxRetryDelay = 30000;

    // Clean up stale streaming buffer only if untouched for 2 hours
    // (avoids deleting a buffer still in use by a concurrent run)
    this._clearStaleStreamBuffer();

    /**
     * Collected metadata including SCM, CI, and custom data
     * @type {Object}
     * @property {Object} [scm] - Source control information (commit, branch, author, etc.)
     * @property {Object} [ci] - CI provider information (build number, URL, etc.)
     * @property {string} [projectDescription] - Project description
     * @property {string} [relatedIssue] - Related issue reference (e.g., JIRA ticket)
     * @property {string[]} [tags] - Tags for categorization
     * @property {Object} [customData] - Custom metadata key-value pairs
     * @property {Object} [htmlReport] - Playwright HTML report metadata
     * @property {Object} [playwrightConfig] - Playwright configuration metadata
     * @property {Object} [playwrightProject] - Playwright project metadata
     * @property {Object} [performance] - Performance summary metrics
     */
    this.metadata = {};
  }

  onBegin(config, suite) {
    this.startTime = new Date().toISOString();
    console.log(`[Piwi Dashboard] Starting test run for project: ${this.options.projectName}`);

    // Collect metadata
    this.metadata = collectMetadata(config, suite, this.options);

    // Start streaming if enabled
    if (this.options.streaming) {
      this._startStreaming();
    }
  }

  /**
   * Authenticate and start a streaming run on the server.
   * Runs asynchronously and sets this.streamingEnabled on success.
   */
  _startStreaming() {
    const self = this;

    // Determine auth credential
    let cookieOrApiKey = null;
    if (this.options.apiKey) {
      cookieOrApiKey = this.options.apiKey;
    }

    // Check if a globalSetup already created an 'initialising' run for us
    const setupInfo = this._readSetupInfo();

    const payload = {
      projectName: this.options.projectName,
      projectDescription: this.options.projectDescription,
      startTime: this.startTime,
      environment: this.options.environment || null,
      metadata: this.metadata,
      instanceId: this.instanceId
    };

    // Fire and forget — we'll check this.streamingEnabled later
    this._streamStartPromise = (async () => {
      try {
        // If using username/password, login first
        if (!cookieOrApiKey && self.options.username && self.options.password) {
          cookieOrApiKey = await loginUser(self.options.serverUrl, self.options.username, self.options.password, self.options.verbose);
        }
        self._streamAuth = cookieOrApiKey;

        // Try to upload any recovery data from a previous failed run
        try {
          await self._tryUploadRecoveryData();
        } catch {
          // Non-fatal — continue with streaming setup
        }

        let response;
        if (setupInfo) {
          // Transition the existing 'initialising' run to 'running'
          response = await postJSON(
            self.options.serverUrl,
            `/api/test-runs/${setupInfo.runId}/begin`,
            {
              setupToken: setupInfo.setupToken,
              totalTests: self.totalTests,
              metadata: self.metadata
            },
            self.options.verbose,
            cookieOrApiKey
          );
        } else {
          response = await postJSON(self.options.serverUrl, '/api/test-runs/start', payload, self.options.verbose, cookieOrApiKey);
        }

        if (response && response.runId && response.streamToken) {
          self.streamingRunId = response.runId;
          self.streamToken = response.streamToken;
          self.streamingEnabled = true;
          console.log(`[Piwi Dashboard] Streaming enabled. Run ID: ${response.runId}`);

          // Flush any begin events that arrived before streaming was ready
          if (self.pendingBeginEvents.length > 0) {
            for (const evt of self.pendingBeginEvents) {
              self.pendingEvents.push(evt);
            }
            self.pendingBeginEvents = [];
            self._flushStreamEvents();
          }
        }
      } catch (error) {
        // Server might not support streaming — fall back to batch mode
        if (self.options.verbose) {
          console.log(`[Piwi Dashboard] Streaming not available: ${error.message}. Will use batch mode.`);
        }
        self.streamingEnabled = false;
      }
    })();
  }

  onTestBegin(test, result) {
    // Convert absolute file path to relative path from project root
    const relativeFilePath = path.relative(process.cwd(), test.location.file);

    const beginEvent = {
      type: 'begin',
      title: test.title,
      location: `${relativeFilePath}:${test.location.line}:${test.location.column}`,
      workerIndex: result?.workerIndex ?? result?.parallelIndex ?? null
    };

    if (this.streamingEnabled && this.streamingRunId) {
      this._queueStreamEvent(beginEvent);
    } else {
      // Streaming not yet ready — buffer for later flush
      this.pendingBeginEvents.push(beginEvent);
    }
  }

  onTestEnd(test, result) {
    this.totalTests++;

    // Convert absolute file path to relative path from project root
    const relativeFilePath = path.relative(process.cwd(), test.location.file);

    const testCase = {
      type: 'complete',
      title: test.title,
      location: `${relativeFilePath}:${test.location.line}:${test.location.column}`,
      status: result.status,
      duration: result.duration,
      error: result.error ? result.error.message : null,
      retries: result.retry,
      workerIndex: result.workerIndex ?? result.parallelIndex ?? null,
      startedAt: result.startTime ? result.startTime.getTime() : null,
      attachments: result.attachments || []
    };

    // Collect performance metrics from steps if enabled
    if (this.options.collectPerformanceMetrics && result.steps && result.steps.length > 0) {
      testCase.performanceMetrics = collectStepMetrics(result.steps);
    }

    // Parse network requests from fixture attachment (reporter/fixtures.js)
    if (this.options.collectPerformanceMetrics && result.attachments) {
      const networkAttachment = result.attachments.find(a => a.name === 'piwi-dashboard-network');
      if (networkAttachment && networkAttachment.body) {
        try {
          testCase.networkRequests = JSON.parse(networkAttachment.body.toString());
        } catch {
          // Ignore parse errors
        }
      }

      // Parse web vitals from fixture attachment
      const webVitalsAttachment = result.attachments.find(a => a.name === 'piwi-dashboard-web-vitals');
      if (webVitalsAttachment && webVitalsAttachment.body) {
        try {
          testCase.webVitals = JSON.parse(webVitalsAttachment.body.toString());
        } catch {
          // Ignore parse errors
        }
      }

      // Parse console logs from fixture attachment
      const consoleAttachment = result.attachments.find(a => a.name === 'piwi-dashboard-console');
      if (consoleAttachment && consoleAttachment.body) {
        try {
          testCase.consoleLogs = JSON.parse(consoleAttachment.body.toString());
        } catch {
          // Ignore parse errors
        }
      }

      // Parse ARIA snapshot from fixture attachment
      const ariaAttachment = result.attachments.find(a => a.name === 'piwi-dashboard-aria-snapshot');
      if (ariaAttachment && ariaAttachment.body) {
        testCase.ariaSnapshot = ariaAttachment.body.toString();
      }
    }

    // Track test status
    switch (result.status) {
      case 'passed':
        this.passedTests++;
        break;
      case 'failed':
        this.failedTests++;
        break;
      case 'skipped':
        this.skippedTests++;
        break;
      case 'timedOut':
        this.timedOutTests++;
        break;
    }

    this.testCases.push(testCase);

    // Queue event for streaming
    if (this.options.streaming) {
      this._queueStreamEvent(testCase);
    }
  }

  /**
   * Map a test case object to the API payload format shared by streaming,
   * JSON upload, and multipart upload.
   */
  _mapTestCase(tc) {
    const { type, ...tcRest } = tc
    return {
      title: tcRest.title,
      location: tcRest.location,
      status: tcRest.status,
      duration: tcRest.duration,
      error: tcRest.error,
      retries: tcRest.retries,
      workerIndex: tcRest.workerIndex ?? null,
      startedAt: tcRest.startedAt ?? null,
      steps: tcRest.performanceMetrics && tcRest.performanceMetrics.steps || null,
      slowestStep: tcRest.performanceMetrics && tcRest.performanceMetrics.slowestStep && tcRest.performanceMetrics.slowestStep.title || null,
      slowestStepDuration: tcRest.performanceMetrics && tcRest.performanceMetrics.slowestStep && tcRest.performanceMetrics.slowestStep.duration || null,
      networkRequests: tcRest.networkRequests || null,
      webVitals: tcRest.webVitals || null,
      consoleLogs: tcRest.consoleLogs || null,
      ariaSnapshot: tcRest.ariaSnapshot || null
    }
  }

  /**
   * Queue a test case event for streaming to the server.
   * Sends in batches to reduce HTTP overhead.
   */
  _queueStreamEvent(testCase) {
    this.pendingEvents.push({
      type: testCase.type || 'complete',
      ...this._mapTestCase(testCase)
    });

    // Flush when batch size is reached
    if (this.pendingEvents.length >= this.options.streamingBatchSize) {
      this._flushStreamEvents();
    } else if (!this.flushTimer) {
      // Set a timer to flush after delay
      this.flushTimer = setTimeout(() => {
        this._flushStreamEvents();
      }, this.options.streamingBatchDelay);
    }
  }

  /**
   * Flush pending events to the server.
   */
  _flushStreamEvents() {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }

    if (this.pendingEvents.length === 0) return;
    if (!this.streamingEnabled || !this.streamingRunId) return;

    const events = this.pendingEvents.splice(0);
    const payload = {
      streamToken: this.streamToken,
      testCases: events
    };

    const promise = postJSON(
      this.options.serverUrl,
      `/api/test-runs/${this.streamingRunId}/events`,
      payload,
      this.options.verbose,
      this._streamAuth
    ).then(() => {
      // Success — reset retry count and clear persistent buffer
      this._retryCount = 0;
      this._clearStreamBuffer();
    }).catch(error => {
      if (this.options.verbose) {
        console.warn(`[Piwi Dashboard] Failed to stream events: ${error.message}`);
      }
      // Save to persistent buffer and schedule a retry with backoff
      this._saveStreamBuffer(events);
      this._scheduleRetryFlush();
    });

    this.flushPromises.push(promise);
  }

  /**
   * Schedule a retry of the flush with exponential backoff.
   */
  _scheduleRetryFlush() {
    if (this._retryTimer) return;
    this._retryCount++;
    const delay = Math.min(1000 * Math.pow(2, this._retryCount - 1), this._maxRetryDelay);
    if (this.options.verbose) {
      console.log(`[Piwi Dashboard] Will retry streaming flush in ${delay}ms (attempt ${this._retryCount})`);
    }
    this._retryTimer = setTimeout(() => {
      this._retryTimer = null;
      // Load buffered events and merge with any new pending events
      const buffered = this._loadStreamBuffer();
      if (buffered.length > 0) {
        this._clearStreamBuffer();
        this.pendingEvents = buffered.concat(this.pendingEvents);
      }
      if (this.pendingEvents.length > 0) {
        this._flushStreamEvents();
      }
    }, delay);
  }

  async onEnd(result) {
    this.endTime = new Date().toISOString();
    const duration = new Date(this.endTime) - new Date(this.startTime);

    // Use Playwright's determination of overall status
    // result.status can be: 'passed', 'failed', 'timedout', 'interrupted'
    let overallStatus = 'failed'; // Default to failed for safety

    if (result && result.status) {
      // Map Playwright's status to our status
      if (result.status === 'passed') {
        overallStatus = 'passed';
      } else if (result.status === 'failed' || result.status === 'timedout' || result.status === 'interrupted') {
        overallStatus = 'failed';
      }
    } else {
      // Fallback to manual calculation if result.status is not available
      if (this.failedTests === 0 && this.timedOutTests === 0 && this.totalTests > 0) {
        overallStatus = 'passed';
      }
    }

    console.log(`[Piwi Dashboard] Test run completed. Status: ${overallStatus} (Playwright result.status: ${result && result.status || 'undefined'})`);
    console.log(`[Piwi Dashboard] Total: ${this.totalTests}, Passed: ${this.passedTests}, Failed: ${this.failedTests}, Skipped: ${this.skippedTests}, TimedOut: ${this.timedOutTests}`);

    // Compute performance summary if enabled
    if (this.options.collectPerformanceMetrics) {
      this.metadata.performance = computePerformanceSummary(this.testCases);
    }

    // Wait for streaming start to complete if it was initiated
    if (this._streamStartPromise) {
      await this._streamStartPromise;
    }

    // Flush any remaining streaming events with retries and persistent buffer
    const MAX_FLUSH_RETRIES = 10;
    for (let attempt = 0; attempt < MAX_FLUSH_RETRIES; attempt++) {
      if (this.streamingEnabled && this.pendingEvents.length > 0) {
        this._flushStreamEvents();
      }
      if (this.flushPromises.length > 0) {
        await Promise.allSettled(this.flushPromises);
        this.flushPromises = [];
      }
      if (this.pendingEvents.length === 0) {
        // Also drain any events from the persistent buffer
        const buffered = this._loadStreamBuffer();
        if (buffered.length > 0) {
          this.pendingEvents = buffered;
          this._clearStreamBuffer();
          continue;
        }
        break;
      }
      if (this.options.verbose) {
        console.warn(`[Piwi Dashboard] ${this.pendingEvents.length} events pending, retrying (attempt ${attempt + 1}/${MAX_FLUSH_RETRIES})...`);
      }
      await new Promise(resolve => setTimeout(resolve, Math.min(1000 * Math.pow(2, attempt), 10000)));
    }

    // If streaming events remain after all retries, persist to buffer
    if (this.pendingEvents.length > 0) {
      this._saveStreamBuffer(this.pendingEvents);
      this.pendingEvents = [];
    }

    // Authenticate if credentials are provided
    let sessionCookie = this._streamAuth || null;
    if (!sessionCookie) {
      if (this.options.apiKey) {
        sessionCookie = this.options.apiKey;
        if (this.options.verbose) {
          console.log('[Piwi Dashboard] Using API key for authentication');
        }
      } else if (this.options.username && this.options.password) {
        try {
          console.log(`[Piwi Dashboard] Authenticating as ${this.options.username}...`);
          sessionCookie = await loginUser(this.options.serverUrl, this.options.username, this.options.password, this.options.verbose);
        } catch (error) {
          console.error(`[Piwi Dashboard] Authentication failed: ${error.message}`);
          throw error;
        }
      }
    }

    // If streaming was enabled, finalize the run on the server
    if (this.streamingEnabled && this.streamingRunId) {
      try {
        await this._finishStreamingRun(overallStatus, duration, sessionCookie);
        this._clearRecoveryData();

        // Still upload reports/traces if configured
        const hasReports = this.options.uploadReport || (this.options.reports && this.options.reports.length > 0);
        if (this.options.uploadTraces || hasReports) {
          try {
            await this._uploadFilesForStreamingRun(sessionCookie);
          } catch (error) {
            console.warn(`[Piwi Dashboard] Failed to upload files for streaming run: ${error.message}`);
          }
        }
        return;
      } catch (error) {
        console.warn(`[Piwi Dashboard] Failed to finalize streaming run: ${error.message}`);
        console.log(`[Piwi Dashboard] Falling back to batch upload...`);
        // Fall through to batch mode
      }
    }

    // Try to upload with files if available (batch mode)
    const hasReports = this.options.uploadReport || (this.options.reports && this.options.reports.length > 0);
    if (this.options.uploadTraces || hasReports) {
      try {
        await this.uploadWithFiles(overallStatus, duration, sessionCookie);
        this._clearRecoveryData();
        return;
      } catch (error) {
        console.warn(`[Piwi Dashboard] Failed to upload with files: ${error.message}`);
        console.log(`[Piwi Dashboard] Falling back to JSON upload...`);
      }
    }

    // Fallback to JSON-only upload
    try {
      await this.uploadJSON(overallStatus, duration, sessionCookie);
      this._clearRecoveryData();
    } catch (error) {
      console.error(`[Piwi Dashboard] All upload methods failed: ${error.message}`);
      // Save to disk so a future run can retry
      this._saveRecoveryData(overallStatus, duration);
    }
  }

  /**
   * Finalize a streaming run on the server.
   */
  async _finishStreamingRun(status, duration, sessionCookie) {
    // Compute durations for P90 calculation
    const durations = this.testCases
      .filter(tc => tc.duration !== null && tc.duration !== undefined)
      .map(tc => tc.duration);

    // Calculate flaky tests
    const flakyTests = this.testCases.filter(
      tc => tc.status === 'passed' && (tc.retries || 0) > 0
    ).length;

    const payload = {
      streamToken: this.streamToken,
      status,
      duration,
      totalTests: this.totalTests,
      passedTests: this.passedTests,
      failedTests: this.failedTests,
      skippedTests: this.skippedTests,
      flakyTests,
      durations,
      metadata: this.metadata
    };

    const response = await postJSON(
      this.options.serverUrl,
      `/api/test-runs/${this.streamingRunId}/finish`,
      payload,
      this.options.verbose,
      sessionCookie
    );

    console.log(`[Piwi Dashboard] Successfully finalized streaming run #${this.streamingRunId}`);
    return response;
  }

  /**
   * Scan configured report directories, compress them, and append to a FormData
   * instance. Shared by _uploadFilesForStreamingRun and uploadWithFiles.
   */
  async _appendReportsToForm(form) {
    const reportsToUpload = [];
    if (this.options.reports && Array.isArray(this.options.reports)) {
      for (const reportConfig of this.options.reports) {
        reportsToUpload.push(reportConfig);
      }
    }

    const hasHtmlReport = reportsToUpload.some(r => r.type === 'html');
    if (this.options.uploadReport && !hasHtmlReport) {
      reportsToUpload.push({ type: 'html' });
    }

    for (const reportConfig of reportsToUpload) {
      const type = reportConfig.type;
      const defaultDir = DEFAULT_REPORT_DIRS[type] || type + '-report';
      const reportDir = reportConfig.dir
        ? findReportDirectory(reportConfig.dir)
        : (type === 'html'
            ? findHTMLReportDirectory()
            : findReportDirectory(defaultDir));

      if (!reportDir) {
        if (this.options.verbose) {
          console.log(`[Piwi Dashboard] No report directory found for type '${type}'`);
        }
        continue;
      }

      console.log(`[Piwi Dashboard] Compressing ${type} report directory: ${reportDir}`);
      const compressed = await compressReportDirectory(reportDir);
      if (compressed) {
        console.log(`[Piwi Dashboard] Adding ${type} report archive: ${compressed.length} bytes`);
        form.append(`report_${type}`, compressed, {
          filename: `${type}-report.gz`
        });

        if (reportConfig.label) {
          form.append(`report_label_${type}`, reportConfig.label);
        }
      }
    }
  }

  /**
   * Find trace files for each test case and append them to a FormData instance.
   * When traceHashMap and missingHashes are provided, only traces whose hash is
   * in missingHashes are uploaded; all hashes are still sent as trace_hashes
   * metadata so the server can create files records for deduplicated traces too.
   *
   * Also uploads all other file-based attachments (screenshots, videos, etc.)
   * as attach_file_<index> / attach_meta_<index> form fields.
   *
   * @param {FormData} form
   * @param {Set<string>|null} missingHashes - Hashes the server needs uploaded; null means upload all.
   * @param {Map<number, { tracePath: string, hash: string, size: number }>|null} traceHashMap
   */
  _appendTracesToForm(form, missingHashes, traceHashMap) {
    if (!this.options.uploadTraces) return

    // --- Non-trace attachments (screenshots, videos, custom files) ---
    let attachmentCount = 0
    for (const [i, testCase] of this.testCases.entries()) {
      const attachments = findAllAttachments(testCase)
      if (attachments.length === 0) continue

      // Metadata: array of { name, contentType, originalName }
      form.append(`attach_meta_${i}`, JSON.stringify(
        attachments.map(a => ({
          name: a.name,
          contentType: a.contentType,
          originalName: a.originalName
        }))
      ))

      for (const attachment of attachments) {
        form.append(`attach_file_${i}`, fs.createReadStream(attachment.path), {
          filename: attachment.originalName
        })
        attachmentCount++
      }
    }
    if (attachmentCount > 0) {
      console.log(`[Piwi Dashboard] Uploading ${attachmentCount} non-trace attachments`)
    }

    // --- Trace files ---
    // Legacy path: no hash map available, upload everything as before
    if (!traceHashMap) {
      let traceCount = 0
      for (const [i, testCase] of this.testCases.entries()) {
        const traceFiles = findTraceFiles(testCase)
        for (const tracePath of traceFiles) {
          if (fs.existsSync(tracePath)) {
            form.append(`trace_${i}`, fs.createReadStream(tracePath), {
              filename: path.basename(tracePath)
            })
            traceCount++
          }
        }
      }
      console.log(`[Piwi Dashboard] Found ${traceCount} trace files`)
      return
    }

    let uploadCount = 0
    let deduplicatedCount = 0
    const hashesObj = {}

    for (const [i, hashInfo] of traceHashMap.entries()) {
      hashesObj[i] = hashInfo.hash
      const isNew = !missingHashes || missingHashes.has(hashInfo.hash)
      if (isNew) {
        form.append(`trace_${i}`, fs.createReadStream(hashInfo.tracePath), {
          filename: path.basename(hashInfo.tracePath)
        })
        uploadCount++
      } else {
        deduplicatedCount++
      }
    }

    // Always send hashes so the server can link files records for reused blobs
    if (Object.keys(hashesObj).length > 0) {
      form.append('trace_hashes', JSON.stringify(hashesObj))
    }

    console.log(`[Piwi Dashboard] Uploading ${uploadCount} trace files (${deduplicatedCount} already stored, skipped)`)
  }

  /**
   * Preflight check: ask the server which of the given hashes it already has stored.
   * Returns a Set of hashes that need to be uploaded.
   * Falls back to returning all hashes as missing on any network or parse error.
   *
   * @param {string} projectName
   * @param {Map<number, { hash: string }>} traceHashMap
   * @param {string|null} sessionCookie
   * @returns {Promise<Set<string>>}
   */
  async _checkMissingTraces(projectName, traceHashMap, sessionCookie) {
    if (traceHashMap.size === 0) return new Set()

    const hashes = [...traceHashMap.values()].map(h => h.hash)

    try {
      const response = await postJSON(
        this.options.serverUrl,
        '/api/traces/check',
        { projectName, hashes },
        this.options.verbose,
        sessionCookie
      )
      const missing = Array.isArray(response.missing) ? response.missing : hashes
      if (this.options.verbose) {
        console.log(`[Piwi Dashboard] Trace preflight: ${missing.length}/${hashes.length} need upload`)
      }
      return new Set(missing)
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`[Piwi Dashboard] Trace preflight failed, uploading all: ${error.message}`)
      }
      return new Set(hashes)
    }
  }

  /**
   * Upload report files and traces for a streaming run that is already created.
   */
  async _uploadFilesForStreamingRun(sessionCookie) {
    const traceHashMap = this.options.uploadTraces ? await computeTraceHashes(this.testCases) : new Map();
    const missingHashes = await this._checkMissingTraces(this.options.projectName, traceHashMap, sessionCookie);

    const form = new FormData();

    // Add run ID to associate files with existing run
    form.append('testRunId', String(this.streamingRunId));
    form.append('projectName', this.options.projectName);

    // We don't re-send testRun data or testCases — they're already on the server
    form.append('testRun', JSON.stringify({
      status: 'already-submitted',
      startTime: this.startTime,
      duration: 0,
      totalTests: 0,
      passedTests: 0,
      failedTests: 0,
      skippedTests: 0,
      metadata: {}
    }));
    form.append('testCases', JSON.stringify([]));

    await this._appendReportsToForm(form);
    this._appendTracesToForm(form, missingHashes, traceHashMap);

    const response = await postFormData(this.options.serverUrl, '/api/test-runs/upload', form, sessionCookie);
    console.log(`[Piwi Dashboard] Successfully uploaded files for streaming run #${this.streamingRunId}`);
    if (response.reports && response.reports.length > 0) {
      for (const r of response.reports) {
        console.log(`[Piwi Dashboard] ${r.label}: ${r.path}`);
      }
    }
  }

  async uploadJSON(overallStatus, duration, sessionCookie) {
    const payload = {
      projectName: this.options.projectName,
      projectDescription: this.options.projectDescription,
      status: overallStatus,
      startTime: this.startTime,
      duration: duration,
      totalTests: this.totalTests,
      passedTests: this.passedTests,
      failedTests: this.failedTests,
      skippedTests: this.skippedTests,
      environment: this.options.environment || null,
      metadata: this.metadata,
      instanceId: this.instanceId,
      testCases: this.testCases.map(tc => this._mapTestCase(tc))
    };

    try {
      const response = await postJSON(this.options.serverUrl, '/api/test-runs/submit', payload, this.options.verbose, sessionCookie);
      console.log(`[Piwi Dashboard] Successfully uploaded test results to ${this.options.serverUrl}`);
      if (response.testRunId) {
        console.log(`[Piwi Dashboard] Test Run ID: ${response.testRunId}, Project ID: ${response.projectId}`);
      }
    } catch (error) {
      console.error(`[Piwi Dashboard] Error uploading test results:`, error.message);
      throw error;
    }
  }

  async uploadWithFiles(overallStatus, duration, sessionCookie) {
    const traceHashMap = this.options.uploadTraces ? await computeTraceHashes(this.testCases) : new Map();
    const missingHashes = await this._checkMissingTraces(this.options.projectName, traceHashMap, sessionCookie);

    const form = new FormData();

    // Add project name
    form.append('projectName', this.options.projectName);

    // Add test run data
    const testRunData = {
      status: overallStatus,
      startTime: this.startTime,
      duration: duration,
      totalTests: this.totalTests,
      passedTests: this.passedTests,
      failedTests: this.failedTests,
      skippedTests: this.skippedTests,
      environment: this.options.environment || null,
      metadata: this.metadata,
      projectDescription: this.options.projectDescription,
      instanceId: this.instanceId
    };
    form.append('testRun', JSON.stringify(testRunData));

    // Add test cases
    const testCasesData = this.testCases.map(tc => this._mapTestCase(tc));
    form.append('testCases', JSON.stringify(testCasesData));

    await this._appendReportsToForm(form);
    this._appendTracesToForm(form, missingHashes, traceHashMap);

    try {
      const response = await postFormData(this.options.serverUrl, '/api/test-runs/upload', form, sessionCookie);
      console.log(`[Piwi Dashboard] Successfully uploaded test results with files to ${this.options.serverUrl}`);
      if (response.testRunId) {
        console.log(`[Piwi Dashboard] Test Run ID: ${response.testRunId}, Project ID: ${response.projectId}`);
      }
      if (response.reports && response.reports.length > 0) {
        for (const r of response.reports) {
          console.log(`[Piwi Dashboard] ${r.label}: ${r.path}`);
        }
      }
    } catch (error) {
      console.error(`[Piwi Dashboard] Error uploading test results with files:`, error.message);
      throw error;
    }
  }

  /**
   * Read and consume setup info written by createGlobalSetup().
   * Returns null if no setup file exists or if the project name doesn't match.
   */
  _readSetupInfo() {
    const setupFile = getSetupFilePath(this.options.projectName);
    try {
      if (fs.existsSync(setupFile)) {
        const info = JSON.parse(fs.readFileSync(setupFile, 'utf8'));
        fs.unlinkSync(setupFile);
        if (info.projectName === this.options.projectName) {
          return info;
        }
      }
    } catch (error) {
      if (this.options.verbose) {
        console.log(`[Piwi Dashboard] Could not read setup info: ${error.message}`);
      }
    }
    return null;
  }

  // ── Persistent streaming buffer ─────────────────────────────────────────────

  _getStreamBufferPath() {
    const hash = crypto.createHash('sha1').update(this.options.projectName).digest('hex').slice(0, 16);
    return path.join(os.tmpdir(), `piwi-dashboard-stream-${hash}.jsonl`);
  }

  _saveStreamBuffer(events) {
    if (events.length === 0) return;
    const filePath = this._getStreamBufferPath();
    try {
      const lines = events.map(e => JSON.stringify(e) + '\n').join('');
      fs.appendFileSync(filePath, lines, 'utf8');
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`[Piwi Dashboard] Failed to save events to buffer: ${error.message}`);
      }
    }
  }

  _loadStreamBuffer() {
    const filePath = this._getStreamBufferPath();
    try {
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, 'utf8');
        return content.split('\n').filter(Boolean).map(line => JSON.parse(line));
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`[Piwi Dashboard] Failed to load buffered events: ${error.message}`);
      }
    }
    return [];
  }

  _clearStreamBuffer() {
    const filePath = this._getStreamBufferPath();
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`[Piwi Dashboard] Failed to clear buffer: ${error.message}`);
      }
    }
  }

  /**
   * Delete the streaming buffer only if it hasn't been modified in the last 2
   * hours.  This avoids removing a buffer still in use by a concurrent run of
   * the same project (e.g. CI shards).
   */
  _clearStaleStreamBuffer() {
    const filePath = this._getStreamBufferPath();
    try {
      if (fs.existsSync(filePath)) {
        const stats = fs.statSync(filePath);
        const twoHours = 2 * 60 * 60 * 1000;
        if (Date.now() - stats.mtimeMs > twoHours) {
          fs.unlinkSync(filePath);
          if (this.options.verbose) {
            console.log(`[Piwi Dashboard] Removed stale stream buffer`);
          }
        }
      }
    } catch (error) {
      if (this.options.verbose) {
        console.warn(`[Piwi Dashboard] Failed to check stale buffer: ${error.message}`);
      }
    }
  }

  // ── Crash recovery ──────────────────────────────────────────────────────────

  _getRecoveryPath() {
    const hash = crypto.createHash('sha1').update(this.options.projectName).digest('hex').slice(0, 16);
    return path.join(os.tmpdir(), `piwi-dashboard-recovery-${hash}.json`);
  }

  /**
   * Save all test data to disk so a future run can upload it.
   */
  _saveRecoveryData(overallStatus, duration) {
    const data = {
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
      testCases: this.testCases.map(tc => this._mapTestCase(tc))
    };
    try {
      fs.writeFileSync(this._getRecoveryPath(), JSON.stringify(data), 'utf8');
      console.log(`[Piwi Dashboard] Saved recovery data for later upload`);
    } catch (error) {
      console.error(`[Piwi Dashboard] Failed to save recovery data: ${error.message}`);
    }
  }

  _loadRecoveryData() {
    const filePath = this._getRecoveryPath();
    try {
      if (fs.existsSync(filePath)) {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
      }
    } catch {}
    return null;
  }

  _clearRecoveryData() {
    const filePath = this._getRecoveryPath();
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {}
  }

  /**
   * Upload recovery data left by a previous run that couldn't reach the server.
   */
  async _tryUploadRecoveryData() {
    const data = this._loadRecoveryData();
    if (!data) return;

    console.log(`[Piwi Dashboard] Found saved test data from a previous run, uploading...`);

    let cookieOrApiKey = this._streamAuth || null;
    if (!cookieOrApiKey && this.options.apiKey) {
      cookieOrApiKey = this.options.apiKey;
    }
    if (!cookieOrApiKey && this.options.username && this.options.password) {
      try {
        cookieOrApiKey = await loginUser(this.options.serverUrl, this.options.username, this.options.password, this.options.verbose);
      } catch {
        console.warn(`[Piwi Dashboard] Cannot authenticate to upload recovery data`);
        return;
      }
    }

    try {
      await postJSON(this.options.serverUrl, '/api/test-runs/submit', data, this.options.verbose, cookieOrApiKey);
      console.log(`[Piwi Dashboard] Successfully uploaded saved test data`);
      this._clearRecoveryData();
    } catch (error) {
      console.warn(`[Piwi Dashboard] Could not upload saved test data: ${error.message}`);
    }
  }
}

/**
 * Return the path to the temp file used to share setup info between
 * createGlobalSetup() and the reporter's _startStreaming().
 * Uses a hash of the project name to avoid filename collisions.
 */
function getSetupFilePath(projectName) {
  const hash = crypto.createHash('sha1').update(projectName).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `piwi-dashboard-setup-${hash}.json`);
}

/**
 * Compute a stable instance identifier based on machine and project.
 * Re-running from the same machine + project produces the same ID,
 * so the server can cancel previous hung runs without affecting
 * runs from other machines.
 */
function computeInstanceId(projectName) {
  return crypto.createHash('sha256')
    .update([os.hostname(), projectName].join('|'))
    .digest('hex')
    .slice(0, 16);
}

module.exports = PiwiDashboardReporter;

/**
 * Create a Playwright globalSetup function that registers the run as 'initialising'
 * on the Piwi Dashboard before tests begin.  The reporter's onBegin hook will then
 * transition that run to 'running', so the dashboard shows the setup phase.
 *
 * @param {import('./index').DashboardReporterOptions} options - Same options as the reporter.
 * @param {Function} [userSetup] - Optional existing globalSetup function to wrap.
 * @returns {Function} A globalSetup function to pass to Playwright's config.
 *
 * @example
 * // playwright.config.ts
 * import { createGlobalSetup } from '@phenx/piwi-dashboard-reporter';
 * export default defineConfig({
 *   globalSetup: createGlobalSetup({ serverUrl: '...', projectName: 'my-project', apiKey: '...' }),
 * });
 */
module.exports.createGlobalSetup = function createGlobalSetup(options, userSetup) {
  return async function globalSetupFn(config) {
    const serverUrl = options.serverUrl || 'http://localhost:3000';
    const projectName = options.projectName || 'default-project';

    let cookieOrApiKey = options.apiKey || null;

    try {
      if (!cookieOrApiKey && options.username && options.password) {
        cookieOrApiKey = await loginUser(serverUrl, options.username, options.password, options.verbose);
      }

      const response = await postJSON(
        serverUrl,
        '/api/test-runs/setup',
        {
          projectName,
          projectDescription: options.projectDescription,
          environment: options.environment || null,
          startTime: new Date().toISOString(),
          instanceId: computeInstanceId(projectName)
        },
        options.verbose,
        cookieOrApiKey
      );

      if (response && response.runId && response.setupToken) {
        const setupFile = getSetupFilePath(projectName);
        fs.writeFileSync(setupFile, JSON.stringify({
          runId: response.runId,
          setupToken: response.setupToken,
          projectName
        }));
        if (options.verbose) {
          console.log(`[Piwi Dashboard] Global setup: initialising run #${response.runId}`);
        }
      }
    } catch (error) {
      // Non-fatal: if setup registration fails the reporter will create a new run normally
      console.warn(`[Piwi Dashboard] Could not register global setup: ${error.message}`);
    }

    if (userSetup) {
      return userSetup(config);
    }
  };
};
