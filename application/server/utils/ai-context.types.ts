import type { AiAttachedImage } from './ai-provider';
import type { DiagnosisContextCoverage } from '~~/types/api';
import type { ScmChanges } from './scm/ScmProvider';

export type DiagnosisScope =
  | { kind: 'cluster'; clusterId: number }
  | { kind: 'execution'; testRunsCaseId: number; clusterId?: number };

export interface BuildContextOptions {
  baseCommit?: string;
  selectedCommitShas?: string[];
  /** When true, resolve screenshot data URLs into `images`. Default true. */
  includeImages?: boolean;
  /** Omit a section by id (used by the UI include/exclude toggles). */
  omitSections?: SectionId[];
}

export type SectionId =
  | 'clusterSummary'
  | 'sampleError'
  | 'affectedTests'
  | 'browserDistribution'
  | 'representativeExecution'
  | 'executionError'
  | 'testSource'
  | 'steps'
  | 'failingSteps'
  | 'console'
  | 'networkRequests'
  | 'serverLogs'
  | 'webVitals'
  | 'ariaSnapshot'
  | 'recurrenceFlakiness'
  | 'scmInvestigation'
  | 'selectedCommits'
  | 'priorDiagnosis'
  | 'passedPeers'
  | 'tracePointers';

export interface ContextSection {
  id: SectionId;
  title: string;
  chars: number;
  truncated: boolean;
  markdown: string;
  items?: number;
}

export interface BuiltDiagnosisContext {
  scope: DiagnosisScope;
  text: string;
  sections: ContextSection[];
  coverage: DiagnosisContextCoverage;
  scmChanges: ScmChanges | null;
  images?: AiAttachedImage[];
  tokenEstimate: number;
  cluster?: {
    id: number;
    signature: string;
    occurrences: number;
    pattern: 'intermittent' | 'persistent' | 'unknown';
  };
}
