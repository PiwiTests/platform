---
title: API reference
lang: en-US
---

# API reference

All endpoints are relative to the dashboard base URL (e.g. `http://localhost:3000`).

> **Interactive API docs:** When the dashboard is running, visit `/docs` for a live, searchable API reference with request/response schemas and a try-it console — powered by Scalar and auto-generated from the Nitro OpenAPI spec.
>
> The OpenAPI 3.1 JSON spec is also served at `GET /_openapi.json`.

::: tip Windows users
The `curl` examples below use Linux/macOS shell syntax (single-quoted bodies, `\` line continuation). On Windows, run them in **Git Bash** or **WSL**, or translate them to PowerShell with `Invoke-RestMethod` — build the body as a hashtable piped through `ConvertTo-Json`. The authentication examples show both forms.
:::

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
  "didNotRunTests": 0,
  "environment": "production",
  "testCases": [
    {
      "title": "should login successfully",
      "status": "passed",
      "duration": 1500,
      "location": "tests/login.spec.ts:10:5",
      "retries": 0,
      "suitePath": ["Auth"],
      "suiteConfig": [{ "mode": "default", "annotations": [] }],
      "testAnnotations": null,
      "browser": {
        "projectName": "Chromium",
        "browserName": "chromium",
        "channel": null,
        "viewport": { "width": 1280, "height": 720 }
      }
    },
    {
      "title": "should handle errors",
      "status": "failed",
      "duration": 2300,
      "location": "tests/errors.spec.ts:5:5",
      "error": "Expected true but got false",
      "retries": 1,
      "suitePath": ["Auth"],
      "suiteConfig": [{ "mode": "default", "annotations": [] }],
      "testAnnotations": [{ "type": "fixme", "description": "Known flaky test" }],
      "browser": {
        "projectName": "Firefox",
        "browserName": "firefox",
        "channel": null,
        "viewport": { "width": 1280, "height": 720 }
      }
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
  "metadata": {},
  "shardIndex": 1,
  "shardTotal": 3
}
```

| Field                | Type    | Required | Description                                                                  |
|----------------------|---------|----------|------------------------------------------------------------------------------|
| `shardIndex`         | number  | no       | 1-based shard index when using Playwright sharding (e.g. 1, 2, 3)           |
| `shardTotal`         | number  | no       | Total number of shards (e.g. 3). When > 1, shards with the same `instanceId` are grouped into one run |

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

### POST `/api/test-runs/setup`

Initialize a test run in `initialising` status. Used with the global setup phase (wrapping `globalSetup` via `createGlobalSetup`). Supports the same fields and shard behaviour as `/start`, but returns a `setupToken` instead of a `streamToken`. Call `/api/test-runs/[id]/begin` with the `setupToken` to transition to `running`.

**Request body**

Same fields as `/start` above.

**Response**

```json
{
  "success": true,
  "runId": 42,
  "projectId": 7,
  "setupToken": "xyz789..."
}
```

---

### POST `/api/test-runs/[id]/begin`

Transition a run from `initialising` to `running`. Requires the `setupToken` from `/setup`.

**Request body**

```json
{
  "setupToken": "xyz789...",
  "totalTests": 0,
  "metadata": {},
  "shardIndex": 1,
  "shardTotal": 3
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
      "type": "begin",
      "title": "should login",
      "location": "tests/login.spec.ts:10:5",
      "suitePath": ["Auth"],
      "suiteConfig": [{ "mode": "default", "annotations": [] }],
      "browser": {
        "projectName": "Chromium",
        "browserName": "chromium",
        "channel": null,
        "viewport": { "width": 1280, "height": 720 }
      }
    },
    {
      "type": "complete",
      "title": "should login",
      "location": "tests/login.spec.ts:10:5",
      "status": "passed",
      "duration": 1500,
      "suitePath": ["Auth"],
      "suiteConfig": [{ "mode": "default", "annotations": [] }],
      "testAnnotations": null,
      "browser": {
        "projectName": "Chromium",
        "browserName": "chromium",
        "channel": null,
        "viewport": { "width": 1280, "height": 720 }
      }
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

### POST `/api/test-runs/[id]/heartbeat`

Liveness ping for an active streaming run. The reporter sends this automatically during idle gaps (when no test events are flowing — e.g. a single long-running test or `beforeAll` setup) so the server can distinguish a still-running run from a crashed one. It bumps the run's activity timestamp; the stale-run reaper marks runs with no recent activity as `interrupted`. No configuration is required.

**Request body**

```json
{
  "streamToken": "abc123..."
}
```

**Response**

```json
{
  "success": true
}
```

---

### POST `/api/test-runs/[id]/case-files`

Upload one test case's trace and attachments while the run is still streaming, so files are viewable in the dashboard as soon as the test finishes. The test case must already have been sent to `/events` — the files are linked to that row.

**Request body** (`multipart/form-data`)

| Field         | Description                                                              |
|---------------|--------------------------------------------------------------------------|
| `streamToken` | The token returned by `/api/test-runs/start`                             |
| `testCase`    | JSON: `{ "title", "location", "retries" }` identifying the streamed case |
| `trace`       | Trace zip file (optional)                                                |
| `trace_hash`  | SHA-256 of the trace content (optional). If the server already has a blob with this hash, the `trace` file can be omitted entirely — the existing blob is linked. |
| `attach_meta` | JSON array of `{ "name", "contentType", "originalName" }` (optional)     |
| `attach_file` | Attachment files, one per `attach_meta` entry, in the same order         |

**Response**

```json
{
  "success": true,
  "testRunsCaseId": 123,
  "traces": 1,
  "attachments": 2
}
```

Repeated uploads for the same case are idempotent (already-stored files are skipped). Returns `404` if the test case has not been streamed yet, `422` if `trace_hash` is provided without a file and no blob with that hash exists, and `409` once the run has finished.

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
  "metadata": {},
  "shardIndex": 1,
  "shardTotal": 3
}
```

| Field                | Type    | Required | Description                                                                  |
|----------------------|---------|----------|------------------------------------------------------------------------------|
| `shardIndex`         | number  | no       | 1-based shard index when using Playwright sharding                          |
| `shardTotal`         | number  | no       | Total number of shards. When set, counters are accumulated across shards, and the run stays `running` until all shards have finished |

**Response** (single shard or non-sharded)

```json
{
  "success": true,
  "testRunId": 42,
  "status": "passed"
}
```

**Response** (sharded, not all shards finished)

```json
{
  "success": true,
  "testRunId": 42,
  "status": "running"
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
| `case-files`     | A trace/attachments were uploaded for a case |
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

Each cluster also carries a compact `diagnosis` field (or `null`) when an AI diagnosis has been run:

```json
"diagnosis": {
  "status": "completed",
  "category": "app-bug",
  "confidence": "high",
  "summary": "Login button click timed out due to race condition in auth flow"
}
```

---

### GET `/api/projects/[id]/flaky-tests`

Detect tests that fail intermittently across recent runs. Analyzes up to `runs` of the most recent terminal runs.

**Query parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `runs` | `number` | `50` | Maximum number of recent runs to analyze (clamped to 1–200) |

**Response** — array of flaky test entries sorted by impact descending:

```json
[
  {
    "testCaseId": 45,
    "latestRunsCaseId": 891,
    "title": "Login flow completes successfully",
    "filePath": "tests/auth.spec.ts",
    "totalRuns": 12,
    "failedRuns": 3,
    "retryPassRuns": 3,
    "alternations": 2,
    "failureRate": 0.25,
    "score": 63,
    "lastFlakeAt": "2024-01-01T12:00:00.000Z",
    "rootCause": "timing",
    "impact": 42,
    "wastedCiMinutes": 3.5,
    "avgFailedDurationMs": 12000
  }
]
```

**Fields**

| Field | Description |
|-------|-------------|
| `testCaseId` | ID of the `test_cases` row |
| `latestRunsCaseId` | ID of the most recent `test_runs_cases` row — use to link to the case detail page |
| `retryPassRuns` | Runs where the test failed on first attempt but passed on a retry |
| `alternations` | Count of pass↔fail status flips across consecutive runs |
| `failureRate` | Fraction of runs where the test's final status was failed/timed out |
| `score` | Composite score 1–100: `round(100 × (0.6 × retryRate + 0.4 × altRate))` |
| `lastFlakeAt` | Start time of the run where flakiness was last detected |
| `rootCause` | Classified root cause: `timing`, `network`, `assertion`, `environment`, or `other` (nullable) |
| `impact` | Impact score based on wasted CI minutes and pipeline blocks |
| `wastedCiMinutes` | Estimated CI minutes wasted on retries (`avgFailedDurationMs / 60000 × retryPassRuns`) |
| `avgFailedDurationMs` | Average duration of failed executions in milliseconds |

Only tests with at least 3 runs AND (`retryPassRuns ≥ 1` OR `alternations ≥ 2`) are included. Returns 404 for unknown projects.

---

### POST `/api/projects/[id]/flaky-classify`

Classify a flaky test's root cause using keyword heuristics. Requires `ADMINISTRATOR` or `REPORTER` role.

**Request body**

```json
{ "testCaseId": 45 }
```

**Response**

```json
{ "testCaseId": 45, "rootCause": "timing" }
```

Classification categories: `timing`, `network`, `assertion`, `environment`, `other`. Returns 404 if the test case is not found.

---

### GET `/api/test-runs/[id]/insights`

Compare a test run against its most recent passing baseline. Returns status changes (regressions, recoveries, recurrences), flaky new tests, performance changes, worker distribution, and new failure clusters.

**Response**

```json
{
  "newRegressions": [{ "title": "...", "filePath": "...", "duration": 5000 }],
  "recurrences": [],
  "recovered": [{ "title": "...", "filePath": "...", "duration": 3000 }],
  "newFlaky": [],
  "slowestTests": [{ "title": "...", "filePath": "...", "duration": 15000 }],
  "mostImproved": [{ "title": "...", "filePath": "...", "durationBefore": 8000, "durationAfter": 3000, "pctChange": -62 }],
  "mostRegressed": [],
  "workerImbalance": [{ "workerIndex": 0, "count": 8 }, { "workerIndex": 1, "count": 3 }],
  "flakyOnRetry": [],
  "clusterNew": [{ "clusterId": 5, "signature": "TimeoutError: locator.click" }]
}
```

Returns 404 for unknown run IDs.

---

### GET `/api/test-cases/[id]/stability-trend`

Time-series data for a single test case's flaky rate, pass rate, and average duration grouped into buckets.

**Query parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `buckets` | `number` | `20` | Number of time buckets (clamped to 5–50) |

**Response**

```json
{
  "testCaseId": 45,
  "buckets": [
    { "date": "2025-03-15", "flakyRate": 0.1, "passRate": 0.9, "avgDuration": 4200, "totalRuns": 10 }
  ]
}
```

---

### GET `/api/projects/[id]/spec-health`

Group test cases by spec file prefix and compute health metrics over the last N days.

**Query parameters**

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `days` | `number` | `30` | Lookback window (clamped to 1–90) |

**Response**

```json
{
  "specs": [
    { "prefix": "tests/checkout", "passRate": 0.92, "flakyRate": 0.05, "failureCount": 3, "testCount": 45, "avgDuration": 3200 }
  ]
}
```

---

### GET `/api/test-runs/[id]`

Get test run details with test cases and suite hierarchy. Includes `flakyTests` count. Failed test cases carry a `failureClusterId` that groups failures sharing the same normalized error fingerprint (see `shared/error-fingerprint.ts`).

**Response — suites** — a flat list of every describe block across all files in the run:

```json
{
  "suites": [
    {
      "filePath": "tests/login.spec.ts",
      "suitePath": ["Auth"],
      "mode": "default",
      "annotations": []
    }
  ]
}
```

**Response — test case fields** — each test case includes suite hierarchy and annotations:

```json
{
  "testCases": [
    {
      "id": 1,
      "title": "should login",
      "filePath": "tests/login.spec.ts",
      "suitePath": ["Auth"],
      "testAnnotations": [{ "type": "fixme", "description": "Known flaky test" }],
      "status": "passed",
      "duration": 1500,
      "location": "tests/login.spec.ts:10:5",
      "browser": { "projectName": "Chromium", "browserName": "chromium", "viewport": { "width": 1280, "height": 720 } }
    }
  ]
}
```

`suitePath` is an array of describe-block names from the Playwright test hierarchy (e.g. `["Auth", "Login flow"]`). `testAnnotations` captures Playwright test marks like `@fixme`, `@slow`, `@skip` set via `test.info().annotations`.

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

Each group also carries a compact `diagnosis` field (or `null`) with the same shape as described under `GET /api/projects/[id]/failure-clusters`.

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

### GET `/api/test-runs/[id]/regression-context`

Identifies the last passing run for the same project and computes what changed between that run and the current one. Designed to answer the question *"what changed since green?"*

**Response — no prior passing run**

```json
{ "hasGreen": false }
```

**Response — prior passing run found**

```json
{
  "hasGreen": true,
  "lastGreenRunId": 41,
  "lastGreenRunAt": "2024-01-10T09:00:00.000Z",
  "lastGreenCommit": "aaa1111aaa1111a",
  "lastGreenBranch": "main",
  "currentCommit": "bbb2222bbb2222b",
  "currentBranch": "main",
  "commitRange": {
    "fromSha": "aaa1111aaa1111a",
    "toSha": "bbb2222bbb2222b",
    "fromShort": "aaa1111",
    "toShort": "bbb2222",
    "repositoryUrl": "https://github.com/owner/repo",
    "compareUrl": "https://github.com/owner/repo/compare/aaa1111aaa1111a...bbb2222bbb2222b",
    "gitCommand": "git log --oneline aaa1111aaa1111a..bbb2222bbb2222b"
  },
  "metadataDiff": [
    { "key": "environment", "label": "Environment", "before": null, "after": "staging" }
  ],
  "newFailures": 3
}
```

| Field | Description |
|-------|-------------|
| `hasGreen` | `false` if no prior passing run exists |
| `lastGreenRunId` | ID of the most recent passing run before this one |
| `lastGreenRunAt` | Start time of that run |
| `lastGreenCommit` / `currentCommit` | SCM commit SHAs, if `collectScmInfo: true` was set in the reporter |
| `commitRange` | Commit range info; `null` if commits are missing or identical. `compareUrl` is constructed for GitHub, GitLab, and Bitbucket; `null` for other hosts. SSH remote URLs are normalized to HTTPS automatically |
| `metadataDiff` | Fields that changed between the two runs: `environment`, `branch`, `ci_provider`, `browsers` |
| `newFailures` | Number of test cases that passed in the last green run but failed in this one |

Requires commit metadata — enable `collectScmInfo: true` in the reporter config to populate `commitRange`.

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

::: code-group

```bash [Linux / macOS]
curl -X POST http://localhost:3000/api/auth/setup \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-secure-password", "name": "Administrator"}'
```

```powershell [Windows (PowerShell)]
$body = @{ username = 'admin'; password = 'your-secure-password'; name = 'Administrator' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/setup `
  -ContentType 'application/json' -Body $body
```

:::

---

### POST `/api/auth/login`

Log in and receive a session cookie.

::: code-group

```bash [Linux / macOS]
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "your-secure-password"}'
```

```powershell [Windows (PowerShell)]
$body = @{ username = 'admin'; password = 'your-secure-password' } | ConvertTo-Json
Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/auth/login `
  -ContentType 'application/json' -Body $body
```

:::

---

### POST `/api/auth/logout`

Invalidate the current session.

---

### OAuth endpoints

OAuth flows require authentication to be enabled (`PIWI_AUTH_ENABLED=true`) and the corresponding provider credentials configured.

#### GET `/api/auth/oauth/:provider/login`

Initiate an OAuth sign-in. Redirects the browser to the provider's authorization page.

Supported providers: `google`, `github`.

```bash
# Redirects to Google's OAuth consent screen
GET http://localhost:3000/api/auth/oauth/google/login
```

#### GET `/api/auth/oauth/:provider/callback`

OAuth callback endpoint — the provider redirects here after the user authorizes. The server validates the state parameter, exchanges the authorization code for a token, creates or links a local user, sets a session cookie, and redirects to the dashboard homepage.

Provider must be configured via `PIWI_OAUTH_GOOGLE_CLIENT_ID` / `PIWI_OAUTH_GITHUB_CLIENT_ID` and their corresponding secrets.

On error, the browser is redirected to `/login?error=<reason>` with one of:
- `access-denied` — user denied the authorization request
- `invalid-state` — CSRF state parameter mismatch
- `missing-code` — no authorization code received
- `oauth-failed` — token exchange or user info fetch failed
- `auth-disabled` — authentication is not enabled
- `invalid-provider` — unknown or unconfigured provider

---

## AI Diagnosis

AI diagnosis uses an LLM to analyze failure clusters and explain their root cause. Configure a provider in **Settings → AI Diagnosis** or via environment variables before using these endpoints.

### GET `/api/ai/status`

Returns whether AI diagnosis is configured. Never returns the API key.

**Response**

```json
{
  "configured": true,
  "provider": "anthropic",
  "model": "claude-opus-4-8",
  "autoDiagnose": true,
  "source": "settings"
}
```

`source` is `"settings"` (database) or `"env"` (environment variables). When `configured` is `false`, only that field is returned.

---

### GET `/api/settings/ai`

Get the current AI provider configuration.

::: info
Requires the **administrator** role when authentication is enabled.
:::

**Response**

```json
{
  "provider": "openai",
  "model": "gpt-4o",
  "baseUrl": "http://localhost:11434/v1",
  "autoDiagnose": false,
  "hasApiKey": true,
  "envManaged": false
}
```

`hasApiKey` is `true` when a key is stored; the key itself is never returned. `envManaged` is `true` when `PIWI_AI_*` environment variables are active — the UI will show the config read-only.

---

### PUT `/api/settings/ai`

Save the AI provider configuration.

::: info
Requires the **administrator** role when authentication is enabled.
:::

**Request body**

```json
{
  "provider": "anthropic",
  "model": "claude-opus-4-8",
  "apiKey": "sk-ant-...",
  "baseUrl": null,
  "autoDiagnose": true
}
```

| Field | Description |
|-------|-------------|
| `provider` | `"anthropic"`, `"openai"`, `null`, or `""` (null/empty disables AI) |
| `model` | Model name (required for OpenAI-compatible, optional for Anthropic — defaults to `claude-opus-4-8`) |
| `apiKey` | `undefined` → keep stored key; `""` → clear key; any string → replace key |
| `baseUrl` | Required for `openai` provider (e.g. `http://localhost:11434/v1`) |
| `autoDiagnose` | When `true`, newly-detected clusters are auto-diagnosed when a run finishes (max 3 per run) |

Returns 400 for invalid provider or missing required fields, 409 if environment-managed.

**Response** — same shape as `GET /api/settings/ai`.

---

### GET `/api/settings/ai/limits`

Get the effective AI diagnosis context limits — caps that bound how much evidence (and therefore how many tokens) go into each diagnosis. Resolved as defaults ← stored settings ← environment variables.

::: info
Requires the **administrator** role when authentication is enabled.
:::

**Response**

```json
{
  "limits": { "sampleErrorChars": 3000, "scmPatchBudget": 4000, "affectedTests": 15, "steps": 30, "consoleEntries": 15, "consoleEntryChars": 400, "networkRequests": 15, "ariaSnapshotChars": 4000, "testSourceChars": 3000 },
  "defaults": { "sampleErrorChars": 3000, "...": "..." },
  "envManaged": ["scmPatchBudget"],
  "fields": [{ "key": "sampleErrorChars", "label": "Error text characters", "envVar": "PIWI_AI_MAX_SAMPLE_ERROR_CHARS", "description": "...", "min": 200, "max": 50000 }]
}
```

`envManaged` lists the limit keys pinned by a `PIWI_AI_MAX_*` environment variable (read-only in the UI). `fields` is the metadata used to render the editor.

---

### PUT `/api/settings/ai/limits`

Save context-limit overrides. Each value is clamped to its field's range; an empty/`null` value resets that field to its default; env-managed fields are ignored.

::: info
Requires the **administrator** role when authentication is enabled.
:::

**Request body**

```json
{ "limits": { "scmPatchBudget": 8000, "steps": 50 } }
```

**Response** — same shape as `GET /api/settings/ai/limits`.

---

### POST `/api/settings/ai/test`

Test the current AI configuration by making a minimal request to the provider.

::: info
Requires the **administrator** role when authentication is enabled.
:::

**Response (success)**

```json
{ "success": true, "model": "claude-opus-4-8" }
```

**Response (failure)**

```json
{ "success": false, "error": "Connection refused — check base URL" }
```

Always returns HTTP 200; errors are reported in the `error` field. Returns 503 if no provider is configured.

---

### GET `/api/failure-clusters/[id]/diagnosis`

Get the stored AI diagnosis for a cluster. Returns `null` if no diagnosis has been run.

**Response**

```json
{
  "id": 1,
  "clusterId": 7,
  "status": "completed",
  "provider": "anthropic",
  "model": "claude-opus-4-8",
  "category": "app-bug",
  "confidence": "high",
  "summary": "Login button click timed out due to a race condition in the auth flow",
  "rootCause": "The auth token refresh is triggered asynchronously but the click handler does not await it…",
  "details": {
    "confidenceScore": 82,
    "severity": "high",
    "affectedArea": "authentication / login",
    "evidence": ["3/12 runs failed in the login step", "All failures show the same locator timeout"],
    "hypotheses": [
      {
        "category": "app-bug",
        "likelihood": 82,
        "rootCause": "The auth token refresh is triggered asynchronously but the click handler does not await it.",
        "evidence": ["All failures show the same locator timeout [steps]"]
      },
      {
        "category": "flaky-test",
        "likelihood": 35,
        "rootCause": "Intermittent timing race that occasionally passes on retry.",
        "evidence": ["3/12 runs failed [recurrenceFlakiness]"]
      }
    ],
    "suggestedFix": {
      "description": "Await the token refresh before asserting login state",
      "file": "tests/auth.spec.ts",
      "code": null,
      "patch": null
    },
    "investigationSteps": ["Confirm whether the failure clears on retry to distinguish race from regression"],
    "preventionTips": ["Add an explicit wait for auth state before navigation assertions"]
  },
  "inputTokens": 1840,
  "outputTokens": 320,
  "durationMs": 4200,
  "createdAt": "2024-01-01T12:00:00.000Z",
  "updatedAt": "2024-01-01T12:00:05.000Z"
}
```

**`status` values**

| Value | Meaning |
|-------|---------|
| `running` | Diagnosis in progress — poll every few seconds |
| `completed` | Diagnosis finished successfully |
| `failed` | LLM call or parsing failed — `error` field contains a message |

A `running` row older than 5 minutes is treated as stale (the server may have restarted mid-call) and can be re-submitted with `force=true`.

---

### POST `/api/failure-clusters/[id]/diagnose`

Run (or re-run) AI diagnosis for a failure cluster. The call is **synchronous** — the response contains the final `completed` or `failed` row.

**Query parameters**

| Parameter | Description |
|-----------|-------------|
| `force=true` | Force re-diagnosis even if a completed result already exists |

**Responses**

| Status | Meaning |
|--------|---------|
| 200 | Diagnosis ran (or existing completed diagnosis returned) — body is the diagnosis row |
| 400 | Invalid cluster ID |
| 404 | Cluster not found |
| 409 | A fresh diagnosis is already running for this cluster — poll `GET …/diagnosis` instead |
| 503 | AI is not configured — set up a provider first |

---

### POST `/api/failure-clusters/[id]/diagnose/stream`

**Streaming variant** of the diagnosis endpoint. Instead of returning the result synchronously, the server sends a **Server-Sent Events (SSE)** stream with real-time thinking tokens and the final structured result.

The client fetches this endpoint with `POST` + `fetch()` + `ReadableStream` reader (not `EventSource`, since a GET-only EventSource cannot send a request body).

**Query parameters**

| Parameter | Description |
|-----------|-------------|
| `force=true` | Force re-diagnosis even if a completed result already exists |

**Request body** (same as the synchronous variant)

```json
{
  "additionalContext": "optional free-form hints from the user",
  "baseCommit": "abc123def",
  "selectedCommitShas": ["def789abc", "ghi012def"]
}
```

**SSE event types**

| Event | Data shape | When |
|-------|------------|------|
| `thinking` | `{ text: string }` | Incremental model reasoning tokens — may arrive in multiple events |
| `result` | `FailureDiagnosis` (same shape as `POST /diagnose` response) | Final structured diagnosis — sent once, then the stream closes |
| `error` | `{ message: string }` | Error occurred — partial thinking text may have been sent before this event |

**Example client consumption**

```typescript
const response = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
const reader = response.body!.getReader();
const decoder = new TextDecoder();
let buffer = '';

while (true) {
  const { done, value } = await reader.read();
  if (done) break;
  buffer += decoder.decode(value, { stream: true });
  for (const msg of buffer.split('\n\n')) {
    // Parse event + data lines, process 'thinking' / 'result' / 'error' events
  }
}
```

**Responses**

| Status | Meaning |
|--------|---------|
| 200 | SSE stream starts — read `event:` lines from the body |
| 400 | Invalid cluster ID |
| 404 | Cluster not found |
| 409 | A fresh diagnosis is already running — poll `GET …/diagnosis` or wait |
| 503 | AI is not configured |
