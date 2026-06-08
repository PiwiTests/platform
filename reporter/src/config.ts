export interface DashboardReporterOptions {
  serverUrl?: string;
  projectName?: string;
  projectDescription?: string;
  uploadTraces?: boolean;
  uploadReport?: boolean;
  collectScmInfo?: boolean;
  collectCiInfo?: boolean;
  collectPerformanceMetrics?: boolean;
  streaming?: boolean;
  streamingBatchSize?: number;
  streamingBatchDelay?: number;
  username?: string | null;
  password?: string | null;
  apiKey?: string | null;
  reports?: Array<{ type: string; dir?: string; label?: string }>;
  environment?: string;
  relatedIssue?: string;
  ciInfo?: string;
  tags?: string[];
  customData?: Record<string, unknown>;
  verbose?: boolean;
  [key: string]: unknown;
}

const DEFAULTS = {
  serverUrl: "http://localhost:3000",
  projectName: "default-project",
  uploadTraces: true,
  uploadReport: true,
  collectScmInfo: true,
  collectCiInfo: true,
  collectPerformanceMetrics: true,
  streaming: true,
  streamingBatchSize: 5,
  streamingBatchDelay: 2000,
  username: null,
  password: null,
  apiKey: null,
  verbose: false,
} as const;

export function resolveOptions(raw: Record<string, any>): DashboardReporterOptions {
  return {
    ...DEFAULTS,
    ...raw,
  };
}
