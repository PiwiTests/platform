import type { PlaywrightTestConfig } from '@playwright/test';

export interface PiwiTestConfig<TestArgs = {}, WorkerArgs = {}> extends PlaywrightTestConfig<TestArgs, WorkerArgs> {
  serverUrl?: string;
  projectName?: string;
  projectDescription?: string;
  uploadTraces?: boolean;
  uploadReport?: boolean;
  liveFileUploads?: boolean;
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
}
