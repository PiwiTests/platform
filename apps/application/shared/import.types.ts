/**
 * Wire shapes for importing historical Playwright blob reports.
 *
 * The browser drives the import one archive per request, so the contract is
 * deliberately small: a pre-flight that judges a batch from its metadata alone,
 * and a single-archive upload that reports exactly what landed.
 */

/** Verdict for one archive, decided before any bytes are uploaded. */
export type ImportCheckStatus =
  /** Within the size limit and not seen before — safe to upload. */
  | 'ok'
  /** Larger than the server accepts; uploading would 413. */
  | 'too-large'
  /** Already imported into this project; uploading would be a no-op. */
  | 'duplicate'
  /** Not a file this endpoint can import (wrong extension, empty, no hash). */
  | 'invalid';

/** What the browser knows about a file without reading it all: name, size, digest. */
export interface ImportCheckFile {
  name: string;
  size: number;
  /** Lower-case hex SHA-256 of the file's bytes. */
  hash: string;
}

export interface ImportCheckResult {
  name: string;
  status: ImportCheckStatus;
  /** Human-readable reason, present for everything except `ok`. */
  message?: string;
  /** The run this archive was already imported as, for `duplicate`. */
  runId?: number;
}

export interface ImportCheckResponse {
  /** Largest archive this server accepts, in bytes. */
  maxBytes: number;
  results: ImportCheckResult[];
}

/** Summary of one imported archive, shown per file on the import page. */
export interface ImportRunResponse {
  status: 'imported' | 'duplicate';
  /**
   * What the archive was. A blob report is a whole run, so its counts describe
   * the archive; a trace is one execution added to a run that may still be
   * growing, so the same counts describe the run, not the file.
   */
  kind: 'blob-report' | 'trace';
  /** The execution a trace archive contributed, as `suite › test`. */
  caseTitle?: string;
  runId: number;
  projectId: number;
  /** Final status of the imported run (`passed`, `failed`, …). */
  runStatus: string;
  startTime: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  didNotRunTests: number;
  flakyTests: number;
  /** Traces carried over from the archive. */
  traceCount: number;
  /** Non-trace attachments carried over (screenshots, videos, …). */
  attachmentCount: number;
  playwrightVersion: string | null;
  /** Playwright project (browser) names found in the archive. */
  projectNames: string[];
  /**
   * Spec paths as recorded, so the user can confirm they match the paths their
   * live runs report — history only joins up when they do.
   */
  filePaths: string[];
  /** Set when the archive is one shard of a larger run, which imports alone. */
  shard: { current: number; total: number } | null;
}
