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
  DEFAULT_REPORT_DIRS
} = require('./lib/files');

/**
 * Playwright Dashboard Reporter
 * Sends test results to a Playwright Dashboard server
 */
class PlaywrightDashboardReporter {
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
    console.log(`[Playwright Dashboard] Starting test run for project: ${this.options.projectName}`);

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
          console.log(`[Playwright Dashboard] Streaming enabled. Run ID: ${response.runId}`);

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
          console.log(`[Playwright Dashboard] Streaming not available: ${error.message}. Will use batch mode.`);
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
      // Flush immediately so the dashboard sees test starts in real-time
      this._flushStreamEvents();
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
      attachments: result.attachments || []
    };

    // Collect performance metrics from steps if enabled
    if (this.options.collectPerformanceMetrics && result.steps && result.steps.length > 0) {
      testCase.performanceMetrics = collectStepMetrics(result.steps);
    }

    // Parse network requests from fixture attachment (reporter/fixtures.js)
    if (this.options.collectPerformanceMetrics && result.attachments) {
      const networkAttachment = result.attachments.find(a => a.name === 'playwright-dashboard-network');
      if (networkAttachment && networkAttachment.body) {
        try {
          testCase.networkRequests = JSON.parse(networkAttachment.body.toString());
        } catch {
          // Ignore parse errors
        }
      }

      // Parse web vitals from fixture attachment
      const webVitalsAttachment = result.attachments.find(a => a.name === 'playwright-dashboard-web-vitals');
      if (webVitalsAttachment && webVitalsAttachment.body) {
        try {
          testCase.webVitals = JSON.parse(webVitalsAttachment.body.toString());
        } catch {
          // Ignore parse errors
        }
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
   * Queue a test case event for streaming to the server.
   * Sends in batches to reduce HTTP overhead.
   */
  _queueStreamEvent(testCase) {
    this.pendingEvents.push({
      type: testCase.type || 'complete',
      title: testCase.title,
      location: testCase.location,
      status: testCase.status,
      duration: testCase.duration,
      error: testCase.error,
      retries: testCase.retries,
      workerIndex: testCase.workerIndex ?? null,
      steps: testCase.performanceMetrics && testCase.performanceMetrics.steps || null,
      slowestStep: testCase.performanceMetrics && testCase.performanceMetrics.slowestStep && testCase.performanceMetrics.slowestStep.title || null,
      slowestStepDuration: testCase.performanceMetrics && testCase.performanceMetrics.slowestStep && testCase.performanceMetrics.slowestStep.duration || null,
      networkRequests: testCase.networkRequests || null,
      webVitals: testCase.webVitals || null
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
    ).catch(error => {
      if (this.options.verbose) {
        console.warn(`[Playwright Dashboard] Failed to stream events: ${error.message}`);
      }
      // Re-queue failed events for the batch upload fallback
      this.pendingEvents.unshift(...events);
    });

    this.flushPromises.push(promise);
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

    console.log(`[Playwright Dashboard] Test run completed. Status: ${overallStatus} (Playwright result.status: ${result && result.status || 'undefined'})`);
    console.log(`[Playwright Dashboard] Total: ${this.totalTests}, Passed: ${this.passedTests}, Failed: ${this.failedTests}, Skipped: ${this.skippedTests}, TimedOut: ${this.timedOutTests}`);

    // Compute performance summary if enabled
    if (this.options.collectPerformanceMetrics) {
      this.metadata.performance = computePerformanceSummary(this.testCases);
    }

    // Wait for streaming start to complete if it was initiated
    if (this._streamStartPromise) {
      await this._streamStartPromise;
    }

    // Flush any remaining streaming events, then retry re-queued events up to 3 times
    const MAX_FLUSH_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_FLUSH_RETRIES; attempt++) {
      if (this.streamingEnabled && this.pendingEvents.length > 0) {
        this._flushStreamEvents();
      }
      if (this.flushPromises.length > 0) {
        await Promise.allSettled(this.flushPromises);
        this.flushPromises = [];
      }
      if (this.pendingEvents.length === 0) break;
      if (this.options.verbose) {
        console.warn(`[Playwright Dashboard] ${this.pendingEvents.length} events re-queued after flush failure, retrying (attempt ${attempt + 1}/${MAX_FLUSH_RETRIES})...`);
      }
    }

    // Authenticate if credentials are provided
    let sessionCookie = this._streamAuth || null;
    if (!sessionCookie) {
      if (this.options.apiKey) {
        sessionCookie = this.options.apiKey;
        if (this.options.verbose) {
          console.log('[Playwright Dashboard] Using API key for authentication');
        }
      } else if (this.options.username && this.options.password) {
        try {
          console.log(`[Playwright Dashboard] Authenticating as ${this.options.username}...`);
          sessionCookie = await loginUser(this.options.serverUrl, this.options.username, this.options.password, this.options.verbose);
        } catch (error) {
          console.error(`[Playwright Dashboard] Authentication failed: ${error.message}`);
          throw error;
        }
      }
    }

    // If streaming was enabled, finalize the run on the server
    if (this.streamingEnabled && this.streamingRunId) {
      try {
        await this._finishStreamingRun(overallStatus, duration, sessionCookie);

        // Still upload reports/traces if configured
        const hasReports = this.options.uploadReport || (this.options.reports && this.options.reports.length > 0);
        if (this.options.uploadTraces || hasReports) {
          try {
            await this._uploadFilesForStreamingRun(sessionCookie);
          } catch (error) {
            console.warn(`[Playwright Dashboard] Failed to upload files for streaming run: ${error.message}`);
          }
        }
        return;
      } catch (error) {
        console.warn(`[Playwright Dashboard] Failed to finalize streaming run: ${error.message}`);
        console.log(`[Playwright Dashboard] Falling back to batch upload...`);
        // Fall through to batch mode
      }
    }

    // Try to upload with files if available (batch mode)
    const hasReports = this.options.uploadReport || (this.options.reports && this.options.reports.length > 0);
    if (this.options.uploadTraces || hasReports) {
      try {
        await this.uploadWithFiles(overallStatus, duration, sessionCookie);
        return;
      } catch (error) {
        console.warn(`[Playwright Dashboard] Failed to upload with files: ${error.message}`);
        console.log(`[Playwright Dashboard] Falling back to JSON upload...`);
      }
    }

    // Fallback to JSON-only upload
    await this.uploadJSON(overallStatus, duration, sessionCookie);
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

    console.log(`[Playwright Dashboard] Successfully finalized streaming run #${this.streamingRunId}`);
    return response;
  }

  /**
   * Upload report files and traces for a streaming run that is already created.
   */
  async _uploadFilesForStreamingRun(sessionCookie) {
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

    // Build the list of reports to upload
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
          console.log(`[Playwright Dashboard] No report directory found for type '${type}'`);
        }
        continue;
      }

      console.log(`[Playwright Dashboard] Compressing ${type} report directory: ${reportDir}`);
      const compressed = await compressReportDirectory(reportDir);
      if (compressed) {
        console.log(`[Playwright Dashboard] Adding ${type} report archive: ${compressed.length} bytes`);
        form.append(`report_${type}`, compressed, {
          filename: `${type}-report.gz`
        });

        if (reportConfig.label) {
          form.append(`report_label_${type}`, reportConfig.label);
        }
      }
    }

    // Add trace files if available
    if (this.options.uploadTraces) {
      let traceCount = 0;
      for (const [i, testCase] of this.testCases.entries()) {
        const traceFiles = findTraceFiles(testCase);
        for (const tracePath of traceFiles) {
          if (fs.existsSync(tracePath)) {
            console.log(`[Playwright Dashboard] Adding trace file: ${tracePath}`);
            form.append(`trace_${i}`, fs.createReadStream(tracePath), {
              filename: path.basename(tracePath)
            });
            traceCount++;
          }
        }
      }
      console.log(`[Playwright Dashboard] Found ${traceCount} trace files`);
    }

    const response = await postFormData(this.options.serverUrl, '/api/test-runs/upload', form, sessionCookie);
    console.log(`[Playwright Dashboard] Successfully uploaded files for streaming run #${this.streamingRunId}`);
    if (response.reports && response.reports.length > 0) {
      for (const r of response.reports) {
        console.log(`[Playwright Dashboard] ${r.label}: ${r.path}`);
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
      testCases: this.testCases.map(tc => {
        const { type, ...tcRest } = tc
        return {
          title: tcRest.title,
          location: tcRest.location,
          status: tcRest.status,
          duration: tcRest.duration,
          error: tcRest.error,
          retries: tcRest.retries,
          workerIndex: tcRest.workerIndex ?? null,
          steps: tcRest.performanceMetrics && tcRest.performanceMetrics.steps || null,
          slowestStep: tcRest.performanceMetrics && tcRest.performanceMetrics.slowestStep && tcRest.performanceMetrics.slowestStep.title || null,
          slowestStepDuration: tcRest.performanceMetrics && tcRest.performanceMetrics.slowestStep && tcRest.performanceMetrics.slowestStep.duration || null,
          networkRequests: tcRest.networkRequests || null,
          webVitals: tcRest.webVitals || null
        }
      })
    };

    try {
      const response = await postJSON(this.options.serverUrl, '/api/test-runs/submit', payload, this.options.verbose, sessionCookie);
      console.log(`[Playwright Dashboard] Successfully uploaded test results to ${this.options.serverUrl}`);
      if (response.testRunId) {
        console.log(`[Playwright Dashboard] Test Run ID: ${response.testRunId}, Project ID: ${response.projectId}`);
      }
    } catch (error) {
      console.error(`[Playwright Dashboard] Error uploading test results:`, error.message);
      throw error;
    }
  }

  async uploadWithFiles(overallStatus, duration, sessionCookie) {
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
    const testCasesData = this.testCases.map((tc, index) => {
      const { type, ...tcRest } = tc;
      // Store the index for trace file mapping
      tcRest.index = index;
      return {
        title: tcRest.title,
        location: tcRest.location,
        status: tcRest.status,
        duration: tcRest.duration,
        error: tcRest.error,
        retries: tcRest.retries,
        workerIndex: tcRest.workerIndex ?? null,
        steps: tcRest.performanceMetrics && tcRest.performanceMetrics.steps || null,
        slowestStep: tcRest.performanceMetrics && tcRest.performanceMetrics.slowestStep && tcRest.performanceMetrics.slowestStep.title || null,
        slowestStepDuration: tcRest.performanceMetrics && tcRest.performanceMetrics.slowestStep && tcRest.performanceMetrics.slowestStep.duration || null,
        networkRequests: tcRest.networkRequests || null,
        webVitals: tcRest.webVitals || null
      };
    });
    form.append('testCases', JSON.stringify(testCasesData));

    // Build the list of reports to upload
    // First, from the new `reports` option (array of { type, dir?, label? })
    const reportsToUpload = [];
    if (this.options.reports && Array.isArray(this.options.reports)) {
      for (const reportConfig of this.options.reports) {
        reportsToUpload.push(reportConfig);
      }
    }

    // Backward compat: if uploadReport is true and 'html' not already in reports, add it
    const hasHtmlReport = reportsToUpload.some(r => r.type === 'html');
    if (this.options.uploadReport && !hasHtmlReport) {
      reportsToUpload.push({ type: 'html' });
    }

    // Upload each report
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
          console.log(`[Playwright Dashboard] No report directory found for type '${type}'`);
        }
        continue;
      }

      console.log(`[Playwright Dashboard] Compressing ${type} report directory: ${reportDir}`);
      const compressed = await compressReportDirectory(reportDir);
      if (compressed) {
        console.log(`[Playwright Dashboard] Adding ${type} report archive: ${compressed.length} bytes`);
        form.append(`report_${type}`, compressed, {
          filename: `${type}-report.gz`
        });

        // Attach optional label override
        if (reportConfig.label) {
          form.append(`report_label_${type}`, reportConfig.label);
        }
      }
    }

    // Add trace files if available
    if (this.options.uploadTraces) {
      let traceCount = 0;
      for (const testCase of this.testCases) {
        const traceFiles = findTraceFiles(testCase);
        for (const tracePath of traceFiles) {
          if (fs.existsSync(tracePath)) {
            console.log(`[Playwright Dashboard] Adding trace file: ${tracePath}`);
            form.append(`trace_${testCase.index}`, fs.createReadStream(tracePath), {
              filename: path.basename(tracePath)
            });
            traceCount++;
          }
        }
      }
      console.log(`[Playwright Dashboard] Found ${traceCount} trace files`);
    }

    try {
      const response = await postFormData(this.options.serverUrl, '/api/test-runs/upload', form, sessionCookie);
      console.log(`[Playwright Dashboard] Successfully uploaded test results with files to ${this.options.serverUrl}`);
      if (response.testRunId) {
        console.log(`[Playwright Dashboard] Test Run ID: ${response.testRunId}, Project ID: ${response.projectId}`);
      }
      if (response.reportPath) {
        console.log(`[Playwright Dashboard] HTML Report: ${response.reportPath}`);
      }
      if (response.reports && response.reports.length > 0) {
        for (const r of response.reports) {
          console.log(`[Playwright Dashboard] ${r.label}: ${r.path}`);
        }
      }
    } catch (error) {
      console.error(`[Playwright Dashboard] Error uploading test results with files:`, error.message);
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
        console.log(`[Playwright Dashboard] Could not read setup info: ${error.message}`);
      }
    }
    return null;
  }
}

/**
 * Return the path to the temp file used to share setup info between
 * createGlobalSetup() and the reporter's _startStreaming().
 * Uses a hash of the project name to avoid filename collisions.
 */
function getSetupFilePath(projectName) {
  const hash = crypto.createHash('sha1').update(projectName).digest('hex').slice(0, 16);
  return path.join(os.tmpdir(), `playwright-dashboard-setup-${hash}.json`);
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

module.exports = PlaywrightDashboardReporter;

/**
 * Create a Playwright globalSetup function that registers the run as 'initialising'
 * on the dashboard before tests begin.  The reporter's onBegin hook will then
 * transition that run to 'running', so the dashboard shows the setup phase.
 *
 * @param {import('./index').DashboardReporterOptions} options - Same options as the reporter.
 * @param {Function} [userSetup] - Optional existing globalSetup function to wrap.
 * @returns {Function} A globalSetup function to pass to Playwright's config.
 *
 * @example
 * // playwright.config.ts
 * import { createGlobalSetup } from '@phenx/playwright-dashboard-reporter';
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
          console.log(`[Playwright Dashboard] Global setup: initialising run #${response.runId}`);
        }
      }
    } catch (error) {
      // Non-fatal: if setup registration fails the reporter will create a new run normally
      console.warn(`[Playwright Dashboard] Could not register global setup: ${error.message}`);
    }

    if (userSetup) {
      return userSetup(config);
    }
  };
};
