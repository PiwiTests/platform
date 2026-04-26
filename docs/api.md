---
title: API reference
lang: en-US
---

# API reference

All endpoints are relative to the dashboard base URL (e.g. `http://localhost:3000`).

## Submission

### POST `/api/test-runs/submit`

Submit test results as JSON. The project is created automatically if it doesn't exist.

**Request body**

```json
{
  "projectName": "my-project",
  "status": "passed",
  "startTime": "2024-01-01T12:00:00Z",
  "duration": 120000,
  "totalTests": 10,
  "passedTests": 9,
  "failedTests": 1,
  "skippedTests": 0,
  "testCases": [
    {
      "title": "should login successfully",
      "status": "passed",
      "duration": 1500,
      "location": "tests/login.spec.ts:10:5",
      "retries": 0
    },
    {
      "title": "should handle errors",
      "status": "failed",
      "duration": 2300,
      "location": "tests/errors.spec.ts:5:5",
      "error": "Expected true but got false",
      "retries": 1
    }
  ]
}
```

**Response**

```json
{
  "success": true,
  "testRunId": 42,
  "projectId": 7
}
```

**Flaky test detection**

A test case is considered flaky when its `status` is `"passed"` and `retries` is greater than `0`. The count of flaky tests is stored on the test run and shown in the dashboard.

---

### POST `/api/test-runs/upload`

Upload test results together with HTML reports and/or trace files using multipart form data.

```bash
curl -X POST http://localhost:3000/api/test-runs/upload \
  -F "projectName=my-project" \
  -F 'testRun={"status":"passed","startTime":"2024-01-01T12:00:00Z","duration":120000,"totalTests":1,"passedTests":1,"failedTests":0,"skippedTests":0}' \
  -F 'testCases=[{"title":"test 1","status":"passed","duration":1500,"location":"tests/test.spec.ts:10:5"}]' \
  -F "report_html=@./playwright-report.gz" \
  -F "trace_0=@./test-results/test-1/trace.zip"
```

**Form fields**

| Field                 | Description                                                           |
|-----------------------|-----------------------------------------------------------------------|
| `projectName`         | Project name (string)                                                 |
| `testRun`             | Test run metadata (JSON string)                                       |
| `testCases`           | Array of test cases (JSON string)                                     |
| `report_<type>`       | Report archive — e.g. `report_html`, `report_monocart`, `report_blob` |
| `report_label_<type>` | Optional display label override for the given report type             |
| `htmlReport`          | Legacy alias for `report_html`                                        |
| `trace_N`             | Trace file for test case at index N (optional, multiple allowed)      |

Multiple report types can be attached in a single upload:

```bash
curl -X POST http://localhost:3000/api/test-runs/upload \
  -F "projectName=my-project" \
  -F "testRun=..." \
  -F "testCases=..." \
  -F "report_html=@./playwright-report.gz" \
  -F "report_monocart=@./monocart-report.gz" \
  -F "report_blob=@./blob-report.zip"
```

---

## Query

### GET `/api/projects`

List all projects with statistics.

**Response** — array of project objects:

```json
[
  {
    "id": 1,
    "name": "my-project",
    "totalRuns": 42,
    "latestRun": {
      "id": 123,
      "status": "passed",
      "flakyTests": 2
    }
  }
]
```

---

### GET `/api/projects/[id]`

Get project details with test runs.

---

### GET `/api/projects/[id]/performance`

Performance trend data for the last N runs, including avg and P90 durations.

---

### GET `/api/projects/[id]/slow-tests`

Top 20 slowest test cases with avg, max, min duration and trend data.

---

### GET `/api/test-runs/[id]`

Get test run details with test cases. Includes `flakyTests` count.

---

### GET `/api/test-runs/[id]/network-requests`

Network requests grouped by `HTTP method + normalised route`.

---

### GET `/api/test-cases/[id]`

Get test case details with traces, steps, web vitals, and network requests.

---

### GET `/api/files/[...path]`

Download HTML report assets and trace files.

---

## Delete

### DELETE `/api/test-runs/[id]`

Delete a test run and all associated data (test cases, traces, reports).

::: info
Requires the **administrator** role when authentication is enabled.
:::

---

## Admin

### GET `/api/admin/stats`

Get storage statistics: total projects, runs, test cases, reports, and on-disk storage size.

::: info
Requires the **administrator** role when authentication is enabled.
:::

---

### DELETE `/api/admin/cleanup`

Delete all test runs older than a given number of days, including their reports and traces.

**Request body**

```json
{ "olderThanDays": 30 }
```

::: info
Requires the **administrator** role when authentication is enabled.
:::

---

## Authentication endpoints

### GET `/api/auth/me`

Returns the current session status.

**Response (unauthenticated)**

```json
{ "authenticated": false, "user": null }
```

---

### POST `/api/auth/setup`

Create the first administrator account. Only available when no users exist in the database.

```bash
curl -X POST http://localhost:3000/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-secure-password", "name": "Administrator"}'
```

---

### POST `/api/auth/login`

Log in and receive a session cookie.

```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-secure-password"}'
```

---

### POST `/api/auth/logout`

Invalidate the current session.
