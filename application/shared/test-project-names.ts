/**
 * All test project names used across the functional test suite.
 *
 * Every name here is deleted before each test run by the cleanup endpoint
 * (`server/api/tests/cleanup.delete.ts`) so that projects can use static
 * names instead of `Date.now()` suffixes.
 *
 * When adding a new test that creates a project:
 * 1. Add a named entry to the `PROJECT` object below (alphabetically sorted by value)
 * 2. Import `PROJECT` from `#shared/test-project-names` (or `../../shared/test-project-names` from server code)
 * 3. Use `PROJECT.YOUR_KEY` in the test instead of a raw string
 * 4. The cleanup will automatically pick it up via `TEST_PROJECT_NAMES`
 */

export const PROJECT = {
  API_CREATED: 'api-created-project',
  API_KEY_SUBMIT: 'api-key-submit-test',
  AUTH_TEST: 'auth-test-project',
  BLOB_GZ: 'blob-gz-test-project',
  DASHBOARD_PERF: 'dashboard-perf-tracking',
  DELETE_TEST: 'delete-test-project',
  DOWNLOAD_TEST: 'download-test-project',
  DUP_UI: 'dup-ui-project',
  DUPLICATE: 'duplicate-project',
  EDIT_TEST: 'edit-test-project',
  EMPTY_METADATA: 'empty-metadata-test',
  EMPTY_PROJECT: 'empty-project',
  BLOCK_LAYOUT: 'block-layout-test',
  ENV_API: 'env-api-test',
  ENV_EMPTY: 'env-empty-test',
  ENV_LATEST_RUN: 'env-latestrun-test',
  ENV_MULTI: 'env-multi-test',
  ENV_NULL: 'env-null-test',
  ENV_RETRIEVAL: 'env-retrieval-test',
  ENV_SETUP: 'env-setup-test',
  ENV_STREAM_START: 'env-stream-start-test',
  ENV_UI: 'env-ui-test',
  ENV_UPLOAD: 'env-upload-test',
  FAILURE_CLUSTERS: 'failure-clusters-test',
  GZIP_MIME: 'gzip-mime-test',
  GZIP_SERVE: 'gzip-serve-test-project',
  GZIP_TEST: 'gzip-test-project',
  HISTORY: 'history-test',
  INCOMPLETE: 'incomplete-project',
  INVALID_KEY: 'invalid-key-test',
  LABEL_OVERRIDE: 'label-override-project',
  LIST_VISIBLE: 'list-visible-project',
  MALFORMED: 'malformed-project',
  METADATA_RETRIEVAL: 'metadata-retrieval-test',
  METADATA_TEST: 'metadata-test-project',
  MINIMAL: 'minimal-project',
  MULTI_REPORT: 'multi-report-project',
  NO_FILES: 'no-files-project',
  NO_METADATA: 'no-metadata-test',
  NO_OVERLAP: 'no-overlap',
  PERF_TEST: 'perf-test-project',
  PG_CONCURRENT: 'pg-concurrent-project',
  PG_TEST: 'pg-test-project',
  REPORTER_API_KEY_E2E: 'reporter-api-key-e2e-test',
  REPORTER_API_KEY_LIB: 'reporter-api-key-lib-test',
  REPORTER_AUTH_LIB: 'reporter-auth-lib-test',
  REPORTER_AUTH: 'reporter-auth-test',
  REPORTER_FULL_AUTH: 'reporter-full-auth-test',
  REPORTER_NO_AUTH: 'reporter-no-auth-test',
  REPORTS_DETAILS: 'reports-details-project',
  REVOKED_KEY: 'revoked-key-test',
  RUN_COMPARE: 'run-compare',
  STATS_TEST: 'stats-test-project',
  STORAGE_TEST: 'storage-test-project',
  STREAMING_DURATION: 'streaming-duration-test',
  STREAMING_FLAKY: 'streaming-flaky-test',
  STREAMING_TEST: 'streaming-test-project',
  TAG_ASSIGNMENT: 'tag-assignment-test-project',
  TEST_API: 'test-api-project',
  TEST_FLAKY: 'test-flaky-project',
  TEST_PROJECT: 'test-project',
  TRACE_DEDUP: 'trace-dedup-test',
  TRACE_PREFLIGHT: 'trace-preflight-test',
  TRACE_RESOURCES: 'trace-resources-test',
  TRACES_API: 'traces-api-test',
  UI_CREATED: 'ui-created',
  UI_TEST: 'ui-test-project',
  UNRELATED: 'unrelated',
  UPLOAD_TEST: 'upload-test-project',
} as const

type ProjectValue = (typeof PROJECT)[keyof typeof PROJECT]

export const TEST_PROJECT_NAMES: ProjectValue[] = Object.values(PROJECT)
