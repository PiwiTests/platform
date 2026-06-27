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
  /**
   * Skip the SCM investigation network fetch (diff since last green + selected
   * commit diffs). Used by the two-stage pipeline to keep the research pass
   * cheap and to only pay for the SCM fetch when it's actually needed.
   */
  skipScm?: boolean;
}

export type SectionId =
  | 'clusterSummary'
  | 'sampleError'
  | 'affectedTests'
  | 'browserDistribution'
  | 'representativeExecution'
  | 'executionError'
  | 'runContext'
  | 'testAnnotations'
  | 'testSource'
  | 'steps'
  | 'failingSteps'
  | 'console'
  | 'networkRequests'
  | 'serverLogs'
  | 'webVitals'
  | 'ariaSnapshot'
  | 'recurrenceFlakiness'
  | 'baselineComparison'
  | 'retryProgression'
  | 'scmInvestigation'
  | 'selectedCommits'
  | 'priorDiagnosis'
  | 'passedPeers'
  | 'tracePointers'
  | 'artifacts'
  | 'nearestAriaNames'
  | 'alreadyGreen'
  | 'topSuspectedCommit';

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
