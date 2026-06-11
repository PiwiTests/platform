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
  "environment": "production",
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
  -F 'testRun={"status":"passed","startTime":"2024-01-01T12:00:00Z","duration":120000,"totalTests":1,"passedTests":1,"failedTests":0,"skippedTests":0,"environment":"production"}' \
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

## Live streaming

The live streaming API allows reporters to send test results in real-time as tests complete, enabling live monitoring in the dashboard UI.

### POST `/api/test-runs/start`

Start a new streaming test run. Returns a `runId` and `streamToken` for subsequent streaming calls.

**Request body**

```json
{
  "projectName": "my-project",
  "projectDescription": "Optional description",
  "startTime": "2024-01-01T12:00:00Z",
  "environment": "staging",
  "metadata": {}
}
```

**Response**

```json
{
  "success": true,
  "runId": 42,
  "projectId": 7,
  "streamToken": "abc123..."
}
```

---

### POST `/api/test-runs/[id]/events`

Stream test case results as they complete. Supports single or batch submission.

**Request body**

```json
{
  "streamToken": "abc123...",
  "testCases": [
    {
      "title": "should login",
      "status": "passed",
      "duration": 1500,
      "location": "tests/login.spec.ts:10:5"
    }
  ]
}
```

**Response**

```json
{
  "success": true,
  "processed": 1
}
```

---

### POST `/api/test-runs/[id]/finish`

Finalize a streaming run with the overall status and summary.

**Request body**

```json
{
  "streamToken": "abc123...",
  "status": "passed",
  "duration": 120000,
  "totalTests": 10,
  "passedTests": 9,
  "failedTests": 1,
  "skippedTests": 0,
  "flakyTests": 0,
  "durations": [1500, 2300, ...],
  "metadata": {}
}
```

**Response**

```json
{
  "success": true,
  "testRunId": 42,
  "status": "passed"
}
```

---

### GET `/api/test-runs/[id]/stream`

Server-Sent Events (SSE) endpoint for real-time monitoring. Connect with `EventSource` in the browser.

**Headers returned**

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `X-Accel-Buffering: no` (nginx compatibility)

**Event types**

| Event type       | Description                                 |
|------------------|---------------------------------------------|
| `init`           | Initial state on connect (catch-up)         |
| `test-completed` | A test case finished                        |
| `run-progress`   | Updated run counters                        |
| `run-finished`   | Run completed — stream will close           |

**Example usage**

```javascript
const source = new EventSource('/api/test-runs/42/stream')
source.onmessage = (event) => {
  const data = JSON.parse(event.data)
  if (data.type === 'test-completed') {
    console.log(`${data.data.title}: ${data.data.status}`)
  }
}
```

::: tip Nginx configuration
For SSE to work behind nginx, add to your proxy configuration:
```nginx
proxy_buffering off;
proxy_cache off;
proxy_read_timeout 3600s;
```
:::

---

### GET `/api/stream`

Global Server-Sent Events endpoint for dashboard-wide run lifecycle notifications. The dashboard connects to this endpoint automatically to refresh pages without polling.

**Headers returned**

- `Content-Type: text/event-stream`
- `Cache-Control: no-cache`
- `X-Accel-Buffering: no` (nginx compatibility)

**Event types**

| Event type       | Description                                               |
|------------------|-----------------------------------------------------------|
| `run-started`    | A new streaming run has been created                      |
| `run-finished`   | A streaming run completed (via `/api/test-runs/[id]/finish`) |
| `run-submitted`  | A run was submitted in one shot (via `/api/test-runs/submit`) |

Each event payload contains `runId`, `projectId`, and (where applicable) `status`.

**Example usage**

```javascript
const source = new EventSource('/api/stream')
source.onmessage = (event) => {
  const data = JSON.parse(event.data)
  console.log(`Run ${data.runId} event: ${data.type}`)
}
```

---

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

### GET `/api/projects/[id]/failure-clusters`

Failure clusters recorded for a project (up to 100, most recently seen first). Each cluster groups failures sharing the same normalized error fingerprint across all runs.

**Query parameters**

| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | `string` | Optional filter: `open`, `resolved`, or `ignored` |

**Response** — array of clusters:

```json
[
  {
    "id": 7,
    "fingerprint": "9f2c…",
    "signature": "TimeoutError: page.goto: Timeout <N>ms exceeded.",
    "errorType": "timeout",
    "selector": null,
    "sampleError": "TimeoutError: page.goto: Timeout 30000ms exceeded.\n…",
    "status": "open",
    "triageNote": null,
    "firstSeenRunId": 142,
    "lastSeenRunId": 198,
    "occurrences": 12,
    "affectedTests": 3,
    "lastSeenRunStatus": "failed",
    "lastSeenAt": "2024-01-01T12:00:00.000Z"
  }
]
```

`occurrences` counts every linked `test_runs_cases` row (retries included, not decremented on run deletion); `affectedTests` is the number of distinct test cases that ever hit the cluster. `status` can be `open`, `resolved`, or `ignored` — managed via the PATCH endpoint below. Returns 404 for unknown projects.

---

### GET `/api/test-runs/[id]`

Get test run details with test cases. Includes `flakyTests` count. Failed test cases carry a `failureClusterId` that groups failures sharing the same normalized error fingerprint (see `shared/error-fingerprint.ts`).

---

### GET `/api/test-runs/[id]/failure-groups`

Returns failures grouped by root cause using error fingerprinting. Each group represents a distinct failure pattern (e.g. a specific timeout or assertion) shared by one or more test cases.

**Response** — array of failure groups:

```json
[
  {
    "clusterId": 7,
    "signature": "TimeoutError: page.goto: Timeout <N>ms exceeded.",
    "errorType": "timeout",
    "selector": null,
    "status": "open",
    "triageNote": null,
    "caseCount": 3,
    "isNew": true,
    "firstSeenRunId": 142,
    "firstSeenAt": "2024-01-01T12:00:00.000Z",
    "occurrences": 3,
    "flaky": false,
    "workerCorrelated": false,
    "cases": [
      {
        "testRunsCaseId": 891,
        "testCaseId": 45,
        "title": "Tab bar navigation works correctly",
        "filePath": "tests/mobile/navigation.spec.ts",
        "retries": 0,
        "workerIndex": 2,
        "passedOnRetry": false
      }
    ]
  }
]
```

**Fields**

| Field | Description |
|-------|-------------|
| `clusterId` | ID of the `failure_clusters` row |
| `signature` | First line of the normalized error message (human-readable cluster name) |
| `errorType` | Heuristic category: `timeout`, `assertion`, `strict-mode`, `navigation`, `crash`, `unknown` |
| `selector` | Playwright locator extracted from the error, if any |
| `status` | Triage status: `open`, `resolved`, or `ignored` |
| `triageNote` | Optional comment attached when the cluster was triaged |
| `isNew` | `true` if this cluster was first seen in this run |
| `firstSeenRunId` | The run where this cluster first appeared |
| `firstSeenAt` | Start time of the first-seen run (`null` if that run was deleted) |
| `occurrences` | Total `test_runs_cases` rows linked to this cluster (not decremented on run deletion) |
| `flaky` | `true` if any test in this group also passed on a later retry in this run |
| `workerCorrelated` | `true` if multiple tests failed on the same worker while the run used several workers (suggests infrastructure issue) |
| `cases` | Array of affected test case results with retry and worker info |

**Sort order**: groups are sorted by `caseCount` descending.

---

### PATCH `/api/failure-clusters/[id]/status`

Update the triage status and optional note for a failure cluster. Used by the triage workflow on the project board.

**Request body**

```json
{
  "status": "resolved",
  "triageNote": "Investigated — flaky test infrastructure"
}
```

`status` is required and must be one of `open`, `resolved`, or `ignored`. `triageNote` is optional (set to `null` to clear).

**Response**

```json
{
  "success": true,
  "id": 7,
  "status": "resolved",
  "triageNote": "Investigated — flaky test infrastructure"
}
```

Returns 400 for invalid status values, 404 for unknown clusters.

---

### GET `/api/test-runs/[id]/network-requests`

Network requests grouped by `HTTP method + normalized route`.

---

### GET `/api/test-cases/[id]`

Get test case details with steps, web vitals, and network requests.

---

### GET `/api/test-cases/[id]/traces`

Get trace files attached to a specific test case result.

**Response**

```json
[
  {
    "id": 1,
    "filePath": "project-1/run-42/1-trace.zip",
    "createdAt": "2024-01-01T12:00:00.000Z"
  }
]
```

Use the `filePath` value with the `/api/files/[...path]` endpoint to open traces in the Playwright trace viewer.

---

### GET `/api/test-cases/[id]/history`

Get execution history for a test case across all runs. Returns up to 50 entries sorted by most recent first.

**Response**

```json
[
  {
    "id": 123,
    "runId": 42,
    "status": "passed",
    "duration": 1500,
    "error": null,
    "retries": 0,
    "startTime": "2024-01-01T12:00:00.000Z",
    "runStatus": "passed"
  }
]
```

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

---

### OAuth endpoints

OAuth flows require authentication to be enabled (`NUXT_AUTH_ENABLED=true`) and the corresponding provider credentials configured.

#### GET `/api/auth/oauth/:provider/login`

Initiate an OAuth sign-in. Redirects the browser to the provider's authorization page.

Supported providers: `google`, `github`.

```bash
# Redirects to Google's OAuth consent screen
GET http://localhost:3000/api/auth/oauth/google/login
```

#### GET `/api/auth/oauth/:provider/callback`

OAuth callback endpoint — the provider redirects here after the user authorizes. The server validates the state parameter, exchanges the authorization code for a token, creates or links a local user, sets a session cookie, and redirects to the dashboard homepage.

Provider must be configured via `NUXT_OAUTH_GOOGLE_CLIENT_ID` / `NUXT_OAUTH_GITHUB_CLIENT_ID` and their corresponding secrets.

On error, the browser is redirected to `/login?error=<reason>` with one of:
- `access-denied` — user denied the authorization request
- `invalid-state` — CSRF state parameter mismatch
- `missing-code` — no authorization code received
- `oauth-failed` — token exchange or user info fetch failed
- `auth-disabled` — authentication is not enabled
- `invalid-provider` — unknown or unconfigured provider
