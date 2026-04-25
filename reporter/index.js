const path = require('path');
const fs = require('fs');
const FormData = require('form-data');
const { collectMetadata } = require('./lib/metadata');
const { collectStepMetrics, computePerformanceSummary } = require('./lib/steps');
const { postJSON, postFormData } = require('./lib/upload');
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
  }

  onTestEnd(test, result) {
    this.totalTests++;

    // Convert absolute file path to relative path from project root
    const relativeFilePath = path.relative(process.cwd(), test.location.file);

    const testCase = {
      title: test.title,
      location: `${relativeFilePath}:${test.location.line}:${test.location.column}`,
      status: result.status,
      duration: result.duration,
      error: result.error ? result.error.message : null,
      retries: result.retry,
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

    // Try to upload with files if available
    const hasReports = this.options.uploadReport || (this.options.reports && this.options.reports.length > 0);
    if (this.options.uploadTraces || hasReports) {
      try {
        await this.uploadWithFiles(overallStatus, duration);
        return;
      } catch (error) {
        console.warn(`[Playwright Dashboard] Failed to upload with files: ${error.message}`);
        console.log(`[Playwright Dashboard] Falling back to JSON upload...`);
      }
    }

    // Fallback to JSON-only upload
    await this.uploadJSON(overallStatus, duration);
  }

  async uploadJSON(overallStatus, duration) {
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
      metadata: this.metadata,
      testCases: this.testCases.map(tc => ({
        title: tc.title,
        location: tc.location,
        status: tc.status,
        duration: tc.duration,
        error: tc.error,
        retries: tc.retries,
        steps: tc.performanceMetrics && tc.performanceMetrics.steps || null,
        slowestStep: tc.performanceMetrics && tc.performanceMetrics.slowestStep && tc.performanceMetrics.slowestStep.title || null,
        slowestStepDuration: tc.performanceMetrics && tc.performanceMetrics.slowestStep && tc.performanceMetrics.slowestStep.duration || null,
        networkRequests: tc.networkRequests || null,
        webVitals: tc.webVitals || null
      }))
    };

    try {
      const response = await postJSON(this.options.serverUrl, '/api/test-runs/submit', payload, this.options.verbose);
      console.log(`[Playwright Dashboard] Successfully uploaded test results to ${this.options.serverUrl}`);
      if (response.testRunId) {
        console.log(`[Playwright Dashboard] Test Run ID: ${response.testRunId}, Project ID: ${response.projectId}`);
      }
    } catch (error) {
      console.error(`[Playwright Dashboard] Error uploading test results:`, error.message);
      throw error;
    }
  }

  async uploadWithFiles(overallStatus, duration) {
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
      metadata: this.metadata,
      projectDescription: this.options.projectDescription
    };
    form.append('testRun', JSON.stringify(testRunData));

    // Add test cases
    const testCasesData = this.testCases.map((tc, index) => {
      // Store the index for trace file mapping
      tc.index = index;
      return {
        title: tc.title,
        location: tc.location,
        status: tc.status,
        duration: tc.duration,
        error: tc.error,
        retries: tc.retries,
        steps: tc.performanceMetrics && tc.performanceMetrics.steps || null,
        slowestStep: tc.performanceMetrics && tc.performanceMetrics.slowestStep && tc.performanceMetrics.slowestStep.title || null,
        slowestStepDuration: tc.performanceMetrics && tc.performanceMetrics.slowestStep && tc.performanceMetrics.slowestStep.duration || null,
        networkRequests: tc.networkRequests || null,
        webVitals: tc.webVitals || null
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
      const response = await postFormData(this.options.serverUrl, '/api/test-runs/upload', form);
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
}

module.exports = PlaywrightDashboardReporter;
