# Playwright Dashboard Reporter

A custom Playwright reporter that sends test results to a Playwright Dashboard server.

## Installation

```bash
npm install --save-dev playwright-dashboard-reporter
```

Or if you're using the dashboard from this repository:

```bash
cd playwright-dashboard/reporter
npm install
```

Then link it in your test project:

```bash
npm link playwright-dashboard-reporter
```

## Usage

Add the reporter to your `playwright.config.ts`:

```typescript
import { defineConfig } from '@playwright/test';

export default defineConfig({
  reporter: [
    ['playwright-dashboard-reporter', {
      serverUrl: 'http://localhost:3000',
      projectName: 'my-test-project',
      uploadTraces: true,
      uploadReport: true
    }]
  ],
  
  // Make sure to enable trace and HTML report
  use: {
    trace: 'retain-on-failure', // or 'on'
  },
});
```

## Configuration Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `serverUrl` | string | `'http://localhost:3000'` | URL of the Playwright Dashboard server |
| `projectName` | string | `'default-project'` | Name of the project to report results under |
| `uploadTraces` | boolean | `true` | Whether to upload trace files to the dashboard |
| `uploadReport` | boolean | `true` | Whether to upload the HTML report to the dashboard |

## Features

- **Automatic Upload**: Automatically uploads test results after test run completion
- **File Upload**: Uploads HTML reports and trace files (if available)
- **Fallback**: Falls back to JSON-only upload if file upload fails
- **Status Tracking**: Tracks passed, failed, skipped, and timed-out tests
- **Project Management**: Automatically creates projects if they don't exist

## How It Works

1. The reporter collects test results during the test run
2. After all tests complete, it uploads results to the dashboard
3. If `uploadTraces` or `uploadReport` is enabled, it tries to find and upload those files
4. Results are visible in the Playwright Dashboard web interface

## Example Output

```
[Playwright Dashboard] Starting test run for project: my-test-project
[Playwright Dashboard] Test run completed. Status: passed
[Playwright Dashboard] Total: 10, Passed: 9, Failed: 1, Skipped: 0
[Playwright Dashboard] Adding HTML report: playwright-report/index.html
[Playwright Dashboard] Adding trace file: test-results/test-1/trace.zip
[Playwright Dashboard] Found 1 trace files
[Playwright Dashboard] Successfully uploaded test results with files to http://localhost:3000
[Playwright Dashboard] Test Run ID: 1, Project ID: 1
[Playwright Dashboard] HTML Report: .data/storage/project-1/run-1234-index.html
[Playwright Dashboard] Uploaded 1 trace files
```

## Requirements

- Node.js 14 or higher
- Playwright Test 1.40 or higher
- Running Playwright Dashboard server

## Troubleshooting

### Reporter not uploading files

Make sure:
1. HTML report is generated (add `html` reporter to your config)
2. Traces are enabled in your Playwright config
3. The dashboard server is running and accessible

### Connection errors

- Check that `serverUrl` is correct and the server is running
- Verify network connectivity to the dashboard server
- Check firewall settings if running on different machines

## License

MIT
