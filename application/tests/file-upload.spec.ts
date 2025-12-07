import { test, expect } from '@playwright/test';
import { writeFileSync, mkdirSync, existsSync } from 'fs';
import { join } from 'path';
import FormData from 'form-data';
import { readFileSync } from 'fs';

test.describe('File Upload API Tests', () => {
  const tempDir = join(process.cwd(), '.test-temp');

  test.beforeAll(() => {
    // Create temp directory for test files
    if (!existsSync(tempDir)) {
      mkdirSync(tempDir, { recursive: true });
    }
    
    // Create mock HTML report
    const htmlContent = `
      <!DOCTYPE html>
      <html>
        <head><title>Test Report</title></head>
        <body><h1>Playwright Test Report</h1></body>
      </html>
    `;
    writeFileSync(join(tempDir, 'test-report.html'), htmlContent);
    
    // Create mock trace file (just a text file for testing)
    writeFileSync(join(tempDir, 'trace.zip'), 'Mock trace data');
  });

  test('should upload test results with HTML report', async ({ request }) => {
    const form = new FormData();
    
    form.append('projectName', 'upload-test-project');
    form.append('testRun', JSON.stringify({
      status: 'passed',
      startTime: new Date().toISOString(),
      duration: 120000,
      totalTests: 3,
      passedTests: 3,
      failedTests: 0,
      skippedTests: 0
    }));
    form.append('testCases', JSON.stringify([
      {
        title: 'test with report',
        status: 'passed',
        duration: 1000,
        location: 'tests/test.spec.ts:10:5'
      }
    ]));
    
    // Read the file
    const htmlReport = readFileSync(join(tempDir, 'test-report.html'));
    form.append('htmlReport', htmlReport, {
      filename: 'index.html',
      contentType: 'text/html'
    });
    
    const response = await request.post('/api/test-runs/upload', {
      multipart: {
        projectName: 'upload-test-project',
        testRun: JSON.stringify({
          status: 'passed',
          startTime: new Date().toISOString(),
          duration: 120000,
          totalTests: 3,
          passedTests: 3,
          failedTests: 0,
          skippedTests: 0
        }),
        testCases: JSON.stringify([
          {
            title: 'test with report',
            status: 'passed',
            duration: 1000,
            location: 'tests/test.spec.ts:10:5'
          }
        ]),
        htmlReport: {
          name: 'index.html',
          mimeType: 'text/html',
          buffer: htmlReport
        }
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
    expect(data.testRunId).toBeDefined();
    expect(data.projectId).toBeDefined();
  });

  test('should handle upload without files', async ({ request }) => {
    const response = await request.post('/api/test-runs/upload', {
      multipart: {
        projectName: 'no-files-project',
        testRun: JSON.stringify({
          status: 'passed',
          startTime: new Date().toISOString(),
          duration: 60000,
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0
        }),
        testCases: JSON.stringify([
          {
            title: 'test without files',
            status: 'passed',
            duration: 500
          }
        ])
      }
    });

    expect(response.ok()).toBeTruthy();
    const data = await response.json();
    expect(data.success).toBe(true);
  });

  test('should reject upload with missing required fields', async ({ request }) => {
    const response = await request.post('/api/test-runs/upload', {
      multipart: {
        projectName: 'incomplete-project'
        // Missing testRun and testCases
      }
    });

    expect(response.status()).toBe(400);
  });

  test('should reject upload with malformed JSON', async ({ request }) => {
    const response = await request.post('/api/test-runs/upload', {
      multipart: {
        projectName: 'malformed-project',
        testRun: '{invalid json}',
        testCases: '[]'
      }
    });

    expect(response.status()).toBe(400);
  });

  test('should download uploaded HTML report', async ({ request }) => {
    // First upload a report
    const uploadResponse = await request.post('/api/test-runs/upload', {
      multipart: {
        projectName: 'download-test-project',
        testRun: JSON.stringify({
          status: 'passed',
          startTime: new Date().toISOString(),
          duration: 60000,
          totalTests: 1,
          passedTests: 1,
          failedTests: 0,
          skippedTests: 0
        }),
        testCases: JSON.stringify([{
          title: 'download test',
          status: 'passed',
          duration: 500
        }]),
        htmlReport: {
          name: 'index.html',
          mimeType: 'text/html',
          buffer: readFileSync(join(tempDir, 'test-report.html'))
        }
      }
    });

    const uploadData = await uploadResponse.json();
    expect(uploadData.reportPath).toBeDefined();
    
    // Try to download the report
    if (uploadData.reportPath) {
      const reportPath = uploadData.reportPath.replace('.data/storage/', '');
      const downloadResponse = await request.get(`/api/files/${reportPath}`);
      
      expect(downloadResponse.ok()).toBeTruthy();
      expect(downloadResponse.headers()['content-type']).toContain('text/html');
    }
  });

  test('should prevent path traversal in file download', async ({ request }) => {
    const response = await request.get('/api/files/../../../etc/passwd');
    expect(response.status()).toBe(403);
  });

  test('should return 404 for non-existent files', async ({ request }) => {
    const response = await request.get('/api/files/project-999/nonexistent.html');
    expect(response.status()).toBe(404);
  });
});
