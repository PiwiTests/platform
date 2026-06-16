import type { BrowserConfig } from '#shared/types';

/**
 * View-types for the JSON columns on `test_runs` / `test_runs_cases`, covering
 * the fields the server reads. The columns are stored as untyped JSON (`mode:
 * 'json'`), so these provide a typed lens instead of scattered `as any` casts.
 */

export interface TestStepInfo {
  title: string;
  duration?: number;
  category?: string;
}

export interface ConsoleLogEntry {
  type: string;
  text: string;
  timestamp?: number;
  location?: string | null;
}

export interface ServerLogEntry {
  timestamp: number;
  level: string;
  category: string;
  message: string;
  stack?: string;
}

export interface NetworkRequestEntry {
  method: string;
  url: string;
  status: number;
  duration?: number;
  resourceType?: string;
  serverLogs?: ServerLogEntry[];
}

export interface WebVitals {
  navigation?: { domContentLoaded?: number | null; loadComplete?: number | null } | null;
  paint?: { FCP?: number | null; LCP?: number | null } | null;
}

/** SCM block of `test_runs.metadata`. */
export interface RunScmMetadata {
  commit?: string | null;
  branch?: string | null;
  remoteUrl?: string | null;
}

/** `test_runs.metadata` JSON — the fields the server reads. */
export interface RunMetadata {
  scm?: RunScmMetadata | null;
  ci?: { provider?: string | null } | null;
  htmlReport?: { projects?: Array<{ use?: { browserName?: string | null } | null }> } | null;
}

export type { BrowserConfig };
