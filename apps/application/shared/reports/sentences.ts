/**
 * The sentence templates of a quality report, one implementation per language
 * (`sentences.en.ts`, `sentences.fr.ts`). Every narrative line (the verdict,
 * what is being done, the risks) and every fixed label comes from here, and
 * each template only repeats the numbers it is given.
 */
import type { MetricId } from '#shared/analytics/metrics';
import type { AnalyticsProgress, AnalyticsRisks, VerdictFacts } from '#shared/analytics/types';
import type { ReportLanguage, ValueFormatter } from './format';
import { EN_SENTENCES } from './sentences.en';
import { FR_SENTENCES } from './sentences.fr';

export interface ReportLabels {
  qualityReport: string;
  period: string;
  comparedWith: string;
  noComparison: string;
  projects: string;
  allProjects: string;
  branchPolicy: string;
  defaultBranch: string;
  allBranches: string;
  branches: string;
  fullRunsOnly: string;
  allRuns: string;
  testFilter: string;
  definitions: string;
  limits: string;
  generated: string;
  generatedBy: string;
  openInPiwi: string;
  dashboard: string;
  noData: string;
  previous: string;
  metric: string;
  value: string;
  change: string;
  date: string;
  unavailable: string;
  daysAreUtc: string;
}

export interface ReportSentences {
  labels: ReportLabels;
  /** The rule-based verdict, two or three sentences. */
  verdict(facts: VerdictFacts, f: ValueFormatter): string;
  /** What is being done, one line per fact worth saying. */
  progress(progress: AnalyticsProgress, f: ValueFormatter): string[];
  /** The risks, one line each; empty when there are none. */
  risks(risks: AnalyticsRisks, f: ValueFormatter): string[];
  /** A metric's label in the language (the catalog label in English). */
  metricLabel(id: MetricId, fallback: string): string;
  /** A metric's one-sentence definition in the language. */
  metricDefinition(id: MetricId, fallback: string): string;
  /** A built-in band or widget title in the language; other titles pass through. */
  title(text: string): string;
  /** `All projects, Last 30 days` */
  reportTitle(scope: string, period: string): string;
  /** `3 projects` */
  projectCount(n: number): string;
  /** The limit line of a test filter: where executions start. */
  testFilterLimit(dataStartsAt: string | null): string;
  /** The limit line of the test-identity lists. */
  identityLimit: string;
}

export function sentencesFor(language: ReportLanguage): ReportSentences {
  return language === 'fr' ? FR_SENTENCES : EN_SENTENCES;
}
