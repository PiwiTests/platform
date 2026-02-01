const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const FormData = require('form-data');
const { compressDirectory } = require('./compression');

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
     */
    this.metadata = {};
  }

  onBegin(config, suite) {
    this.startTime = new Date().toISOString();
    console.log(`[Playwright Dashboard] Starting test run for project: ${this.options.projectName}`);
    
    // Collect metadata
    this.metadata = this.collectMetadata(config, suite);
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

  collectMetadata(config, suite) {
    const metadata = {};

    // Add user-provided metadata from options
    if (this.options.projectDescription) {
      metadata.projectDescription = this.options.projectDescription;
    }
    if (this.options.relatedIssue) {
      metadata.relatedIssue = this.options.relatedIssue;
    }
    if (this.options.ciInfo) {
      metadata.ciInfo = this.options.ciInfo;
    }
    if (this.options.tags && Array.isArray(this.options.tags)) {
      metadata.tags = this.options.tags;
    }
    if (this.options.customData) {
      metadata.customData = this.options.customData;
    }

    // Collect SCM info (git)
    if (this.options.collectScmInfo) {
      metadata.scm = this.collectScmInfo();
    }

    // Collect CI info from environment
    if (this.options.collectCiInfo) {
      metadata.ci = this.collectCiInfo();
    }

    // Extract metadata from Playwright HTML report if available
    const htmlMetadata = this.extractHtmlReportMetadata(config);
    if (htmlMetadata && Object.keys(htmlMetadata).length > 0) {
      metadata.htmlReport = htmlMetadata;
    }

    // Extract metadata from Playwright config
    if (config.metadata) {
      metadata.playwrightConfig = config.metadata;
    }

    // Extract project metadata from suite
    if (suite && suite.allTests && suite.allTests().length > 0) {
      const firstTest = suite.allTests()[0];
      if (firstTest && firstTest.parent && firstTest.parent.project) {
        const project = firstTest.parent.project();
        if (project && project.metadata) {
          metadata.playwrightProject = project.metadata;
        }
      }
    }

    return metadata;
  }

  collectScmInfo() {
    const scm = {};
    try {
      const execOptions = { encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024 };
      
      // Get git commit hash
      scm.commit = execSync('git rev-parse HEAD', execOptions).trim();
      
      // Get git branch
      scm.branch = execSync('git rev-parse --abbrev-ref HEAD', execOptions).trim();
      
      // Get git author
      scm.author = execSync('git log -1 --pretty=format:"%an"', execOptions).trim();
      
      // Get git commit message
      scm.commitMessage = execSync('git log -1 --pretty=format:"%s"', execOptions).trim();
      
      // Get git remote URL (if available)
      try {
        scm.remoteUrl = execSync('git config --get remote.origin.url', execOptions).trim();
      } catch (e) {
        // Remote URL may not be available
      }
    } catch (error) {
      // Git not available or not a git repository
      if (this.options.verbose) {
        console.log('[Playwright Dashboard] Git info not available:', error.message);
      }
    }
    return Object.keys(scm).length > 0 ? scm : undefined;
  }

  collectCiInfo() {
    const ci = {};
    const env = process.env;

    // Detect and collect CI-specific information
    
    // Jenkins
    if (env.JENKINS_URL) {
      ci.provider = 'Jenkins';
      ci.buildNumber = env.BUILD_NUMBER;
      ci.buildUrl = env.BUILD_URL;
      ci.jobName = env.JOB_NAME;
    }
    
    // GitHub Actions
    else if (env.GITHUB_ACTIONS) {
      ci.provider = 'GitHub Actions';
      ci.runId = env.GITHUB_RUN_ID;
      ci.runNumber = env.GITHUB_RUN_NUMBER;
      ci.workflow = env.GITHUB_WORKFLOW;
      ci.actor = env.GITHUB_ACTOR;
      ci.repository = env.GITHUB_REPOSITORY;
      ci.ref = env.GITHUB_REF;
      ci.sha = env.GITHUB_SHA;
      ci.serverUrl = env.GITHUB_SERVER_URL;
      // Only construct build URL if all required parts are available
      if (ci.serverUrl && ci.repository && ci.runId) {
        ci.buildUrl = `${ci.serverUrl}/${ci.repository}/actions/runs/${ci.runId}`;
      }
    }
    
    // GitLab CI
    else if (env.GITLAB_CI) {
      ci.provider = 'GitLab CI';
      ci.pipelineId = env.CI_PIPELINE_ID;
      ci.pipelineUrl = env.CI_PIPELINE_URL;
      ci.jobId = env.CI_JOB_ID;
      ci.jobUrl = env.CI_JOB_URL;
      ci.jobName = env.CI_JOB_NAME;
    }
    
    // CircleCI
    else if (env.CIRCLECI) {
      ci.provider = 'CircleCI';
      ci.buildNumber = env.CIRCLE_BUILD_NUM;
      ci.buildUrl = env.CIRCLE_BUILD_URL;
      ci.jobName = env.CIRCLE_JOB;
      ci.workflow = env.CIRCLE_WORKFLOW_ID;
    }
    
    // Travis CI
    else if (env.TRAVIS) {
      ci.provider = 'Travis CI';
      ci.buildNumber = env.TRAVIS_BUILD_NUMBER;
      ci.buildUrl = env.TRAVIS_BUILD_WEB_URL;
      ci.jobNumber = env.TRAVIS_JOB_NUMBER;
    }
    
    // Azure Pipelines
    else if (env.TF_BUILD) {
      ci.provider = 'Azure Pipelines';
      ci.buildNumber = env.BUILD_BUILDNUMBER;
      ci.buildId = env.BUILD_BUILDID;
      // Only construct build URL if all required parts are available
      if (env.SYSTEM_TEAMFOUNDATIONSERVERURI && env.SYSTEM_TEAMPROJECT && env.BUILD_BUILDID) {
        ci.buildUrl = `${env.SYSTEM_TEAMFOUNDATIONSERVERURI}${env.SYSTEM_TEAMPROJECT}/_build/results?buildId=${env.BUILD_BUILDID}`;
      }
      ci.jobName = env.AGENT_JOBNAME;
    }
    
    // Generic CI detection
    else if (env.CI) {
      ci.provider = 'Unknown CI';
      ci.detected = true;
    }

    return Object.keys(ci).length > 0 ? ci : undefined;
  }

  extractHtmlReportMetadata(config) {
    const metadata = {};
    
    // Extract browser/project info from config
    if (config.projects && config.projects.length > 0) {
      metadata.projects = config.projects.map(p => ({
        name: p.name,
        testDir: p.testDir,
        use: {
          browserName: p.use?.browserName,
          viewport: p.use?.viewport,
          deviceScaleFactor: p.use?.deviceScaleFactor
        }
      }));
    }
    
    // Add test configuration
    metadata.workers = config.workers;
    metadata.timeout = config.timeout;
    metadata.fullyParallel = config.fullyParallel;
    
    return metadata;
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

    console.log(`[Playwright Dashboard] Test run completed. Status: ${overallStatus} (Playwright result.status: ${result?.status || 'undefined'})`);
    console.log(`[Playwright Dashboard] Total: ${this.totalTests}, Passed: ${this.passedTests}, Failed: ${this.failedTests}, Skipped: ${this.skippedTests}, TimedOut: ${this.timedOutTests}`);

    // Try to upload with files if available
    if (this.options.uploadTraces || this.options.uploadReport) {
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
        retries: tc.retries
      }))
    };

    return new Promise((resolve, reject) => {
      const url = new URL('/api/test-runs/submit', this.options.serverUrl);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const postData = JSON.stringify(payload);

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(postData)
        }
      };

      const req = lib.request(reqOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[Playwright Dashboard] Successfully uploaded test results to ${this.options.serverUrl}`);
            try {
              const response = JSON.parse(data);
              console.log(`[Playwright Dashboard] Test Run ID: ${response.testRunId}, Project ID: ${response.projectId}`);
            } catch (e) {
              // Ignore JSON parse errors
            }
            resolve();
          } else {
            console.error(`[Playwright Dashboard] Failed to upload test results. Status: ${res.statusCode}`);
            console.error(`[Playwright Dashboard] Response: ${data}`);
            reject(new Error(`Upload failed with status ${res.statusCode}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error(`[Playwright Dashboard] Error uploading test results:`, error.message);
        reject(error);
      });

      req.write(postData);
      req.end();
    });
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

    // Add test cases (without attachments for now)
    const testCasesData = this.testCases.map((tc, index) => {
      // Store the index for trace file mapping
      tc.index = index;
      return {
        title: tc.title,
        location: tc.location,
        status: tc.status,
        duration: tc.duration,
        error: tc.error,
        retries: tc.retries
      };
    });
    form.append('testCases', JSON.stringify(testCasesData));

    // Add HTML report if available (compress the entire directory)
    if (this.options.uploadReport) {
      const reportDir = this.findHTMLReportDirectory();
      if (reportDir && fs.existsSync(reportDir)) {
        console.log(`[Playwright Dashboard] Compressing HTML report directory: ${reportDir}`);
        try {
          const compressed = await compressDirectory(reportDir);
          if (compressed) {
            console.log(`[Playwright Dashboard] Adding HTML report archive: ${compressed.length} bytes`);
            form.append('htmlReport', compressed, {
              filename: 'playwright-report.gz'
            });
          }
        } catch (error) {
          console.warn(`[Playwright Dashboard] Failed to compress HTML report: ${error.message}`);
        }
      }
    }

    // Add trace files if available
    if (this.options.uploadTraces) {
      let traceCount = 0;
      for (const testCase of this.testCases) {
        const traceFiles = this.findTraceFiles(testCase);
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

    return new Promise((resolve, reject) => {
      const url = new URL('/api/test-runs/upload', this.options.serverUrl);
      const isHttps = url.protocol === 'https:';
      const lib = isHttps ? https : http;

      const reqOptions = {
        hostname: url.hostname,
        port: url.port || (isHttps ? 443 : 80),
        path: url.pathname,
        method: 'POST',
        headers: form.getHeaders()
      };

      const req = lib.request(reqOptions, (res) => {
        let data = '';

        res.on('data', (chunk) => {
          data += chunk;
        });

        res.on('end', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            console.log(`[Playwright Dashboard] Successfully uploaded test results with files to ${this.options.serverUrl}`);
            try {
              const response = JSON.parse(data);
              console.log(`[Playwright Dashboard] Test Run ID: ${response.testRunId}, Project ID: ${response.projectId}`);
              if (response.reportPath) {
                console.log(`[Playwright Dashboard] HTML Report: ${response.reportPath}`);
              }
              if (response.tracesCount) {
                console.log(`[Playwright Dashboard] Uploaded ${response.tracesCount} trace files`);
              }
            } catch (e) {
              // Ignore JSON parse errors
            }
            resolve();
          } else {
            console.error(`[Playwright Dashboard] Failed to upload test results. Status: ${res.statusCode}`);
            console.error(`[Playwright Dashboard] Response: ${data}`);
            reject(new Error(`Upload failed with status ${res.statusCode}`));
          }
        });
      });

      req.on('error', (error) => {
        console.error(`[Playwright Dashboard] Error uploading test results:`, error.message);
        reject(error);
      });

      form.pipe(req);
    });
  }

  findHTMLReport() {
    // Common locations for Playwright HTML reports
    const possiblePaths = [
      'playwright-report/index.html',
      './playwright-report/index.html',
      path.join(process.cwd(), 'playwright-report', 'index.html')
    ];

    for (const reportPath of possiblePaths) {
      if (fs.existsSync(reportPath)) {
        return reportPath;
      }
    }

    return null;
  }

  findHTMLReportDirectory() {
    // Common locations for Playwright HTML report directories
    const possibleDirs = [
      'playwright-report',
      './playwright-report',
      path.join(process.cwd(), 'playwright-report')
    ];

    for (const reportDir of possibleDirs) {
      if (fs.existsSync(reportDir) && fs.statSync(reportDir).isDirectory()) {
        // Verify it contains index.html
        const indexPath = path.join(reportDir, 'index.html');
        if (fs.existsSync(indexPath)) {
          return reportDir;
        }
      }
    }

    return null;
  }



  findTraceFiles(testCase) {
    const traceFilesSet = new Set();

    // Look in attachments for trace files
    // This is the primary and most reliable source since Playwright provides the exact paths
    if (testCase.attachments && testCase.attachments.length > 0) {
      for (const attachment of testCase.attachments) {
        if (attachment.name === 'trace' && attachment.path) {
          // Normalize path to absolute path for deduplication
          const normalizedPath = path.resolve(attachment.path);
          traceFilesSet.add(normalizedPath);
        }
      }
    }

    // Convert Set back to array
    return Array.from(traceFilesSet);
  }

  findFilesRecursive(dir, filename) {
    const results = [];

    try {
      const files = fs.readdirSync(dir);

      for (const file of files) {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
          results.push(...this.findFilesRecursive(filePath, filename));
        } else if (file === filename) {
          results.push(filePath);
        }
      }
    } catch (error) {
      // Ignore errors reading directories
    }

    return results;
  }
}

module.exports = PlaywrightDashboardReporter;
