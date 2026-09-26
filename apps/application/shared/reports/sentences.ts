/**
 * The sentence templates of a quality report, one implementation per language
 * (`sentences.en.ts`, `sentences.fr.ts`). Every narrative line (the verdict,
 * what is being done, the risks) and every fixed label comes from here, and
 * each template only repeats the numbers it is given.
 */
import type { MetricId } from '#shared/analytics/metrics';
import type {
  AnalyticsListItem,
  AnalyticsProgress,
  AnalyticsRisks,
  AnalyticsTileTarget,
  VerdictFacts,
} from '#shared/analytics/types';
import type { ProjectTargetVerdict } from '#shared/analytics/targets';
import type { InsightFacts, InsightText } from '#shared/analytics/insight-rules';
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
  feature: string;
  gapClass: string;
  score: string;
  count: string;
  targets: string;
  /** Before the timeline markers under a chart, in the Markdown. */
  markers: string;
  /** Under the title of a live dashboard link. */
  liveDashboard: string;
  /** Beside the link to the report a share link opens without an account. */
  readWithoutAccount: string;
}

export interface ReportSentences {
  labels: ReportLabels;
  /** Between a label and its value: `: `, and a no-break space before the colon in French. */
  colon: string;
  /** The rule-based verdict, two or three sentences. */
  verdict(facts: VerdictFacts, f: ValueFormatter): string;
  /** What is being done, one line per fact worth saying. */
  progress(progress: AnalyticsProgress, f: ValueFormatter): string[];
  /** The risks, one line each; empty when there are none. */
  risks(risks: AnalyticsRisks, f: ValueFormatter): string[];
  /** One target over the period, met, missed or with nothing to judge it on. */
  target(verdict: ProjectTargetVerdict, f: ValueFormatter): string;
  /** A tile's target mark; `target` is the formatted target for one project, null across projects. */
  tileTarget(mark: AnalyticsTileTarget, target: string | null): string;
  /** An insight's sentences, written from its facts in the language. */
  insight(facts: InsightFacts, f: ValueFormatter): InsightText;
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
  /** A scenario gap class in words (`blind-spot` → `Blind spot`). */
  gapClass(cls: string): string;
  /** A scenario gap's title in the language, written again from its detector's template; unknown titles pass through. */
  gapTitle(detector: string | undefined, title: string): string;
  /** A list widget item's name and detail line in the language, from its facts. */
  listItem(item: AnalyticsListItem, f: ValueFormatter): { title: string; detail: string };
  /** The limit line of a schedule's first quality report, which covers only the days since it was created. */
  firstRunLimit(since: string): string;
  /** The label under an AI-written narrative. */
  narrativeGenerated(model: string): string;
  /** The note of a narrative that fell back to the rule-based verdict. */
  narrativeFallback: string;
}

export function sentencesFor(language: ReportLanguage): ReportSentences {
  return language === 'fr' ? FR_SENTENCES : EN_SENTENCES;
}
