const https = require('https');
const http = require('http');
const { URL } = require('url');
const fs = require('fs');
const path = require('path');
const FormData = require('form-data');
const archiver = require('archiver');

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
  }

  onBegin(config, suite) {
    this.startTime = new Date().toISOString();
    console.log(`[Playwright Dashboard] Starting test run for project: ${this.options.projectName}`);
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
      status: overallStatus,
      startTime: this.startTime,
      duration: duration,
      totalTests: this.totalTests,
      passedTests: this.passedTests,
      failedTests: this.failedTests,
      skippedTests: this.skippedTests,
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
      skippedTests: this.skippedTests
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

    // Add HTML report if available (zip the entire directory)
    if (this.options.uploadReport) {
      const reportDir = this.findHTMLReportDirectory();
      if (reportDir && fs.existsSync(reportDir)) {
        console.log(`[Playwright Dashboard] Zipping HTML report directory: ${reportDir}`);
        try {
          const zipPath = await this.zipDirectory(reportDir);
          if (zipPath && fs.existsSync(zipPath)) {
            console.log(`[Playwright Dashboard] Adding HTML report archive: ${zipPath}`);
            form.append('htmlReport', fs.createReadStream(zipPath), {
              filename: 'playwright-report.zip'
            });
          }
        } catch (error) {
          console.warn(`[Playwright Dashboard] Failed to zip HTML report: ${error.message}`);
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

  async zipDirectory(sourceDir) {
    return new Promise((resolve, reject) => {
      const tempDir = path.join(process.cwd(), '.temp-dashboard');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }

      const outputPath = path.join(tempDir, `playwright-report-${Date.now()}.zip`);
      const output = fs.createWriteStream(outputPath);
      const archive = archiver('zip', {
        zlib: { level: 9 } // Maximum compression
      });

      output.on('close', () => {
        console.log(`[Playwright Dashboard] Report archive created: ${archive.pointer()} bytes`);
        resolve(outputPath);
      });

      archive.on('error', (err) => {
        reject(err);
      });

      archive.pipe(output);
      
      // Add all files from the report directory
      archive.directory(sourceDir, false);
      
      archive.finalize();
    });
  }

  findTraceFiles(testCase) {
    const traceFiles = [];

    // Look in attachments for trace files
    if (testCase.attachments && testCase.attachments.length > 0) {
      for (const attachment of testCase.attachments) {
        if (attachment.name === 'trace' && attachment.path) {
          traceFiles.push(attachment.path);
        }
      }
    }

    // Also look in common test-results directories
    const testResultsDirs = [
      'test-results',
      './test-results',
      path.join(process.cwd(), 'test-results')
    ];

    for (const dir of testResultsDirs) {
      if (fs.existsSync(dir)) {
        // Find trace.zip files
        const files = this.findFilesRecursive(dir, 'trace.zip');
        traceFiles.push(...files);
      }
    }

    return traceFiles;
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
