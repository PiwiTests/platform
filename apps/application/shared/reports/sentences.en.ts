import type { AnalyticsProgress, AnalyticsRisks, VerdictFacts } from '#shared/analytics/types';
import { passRateDirection } from './verdict';
import type { ValueFormatter } from './format';
import type { ReportSentences } from './sentences';

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function branchText(facts: VerdictFacts): string {
  const { kind, branches } = facts.branch;
  if (kind === 'any') return 'across all branches';
  if (branches.length === 1) return `on ${branches[0]}`;
  if (kind === 'default') return 'on the default branches';
  return `on ${branches.join(', ')}`;
}

function comparisonText(facts: VerdictFacts): string {
  switch (facts.comparison) {
    case 'year':
      return 'a year earlier';
    case 'previous-unit':
      return 'the previous period';
    case 'custom':
      return 'the comparison period';
    default:
      return 'the previous period';
  }
}

function verdict(facts: VerdictFacts, f: ValueFormatter): string {
  if (facts.runs === 0 || facts.passRate === null) {
    return 'No runs were recorded for this scope in the period.';
  }
  const rate = f.value(facts.passRate, 'percent', 1);
  const where = branchText(facts);
  const direction = passRateDirection(facts);
  const points = facts.passRateDelta === null ? '' : f.number(Math.abs(facts.passRateDelta), 1);
  const fixed =
    facts.fixed > 0
      ? `, and ${facts.fixed} ${plural(facts.fixed, 'failure cause was', 'failure causes were')} fixed`
      : '';
  let first: string;
  if (direction === 'up') {
    first = `The suite is healthier than ${comparisonText(facts)}: the pass rate ${where} rose ${points} points to ${rate}${fixed}.`;
  } else if (direction === 'down') {
    first = `The suite is less healthy than ${comparisonText(facts)}: the pass rate ${where} fell ${points} points to ${rate}${fixed}.`;
  } else if (facts.previousPassRate !== null) {
    first = `The suite is holding steady: the pass rate ${where} is ${rate}, as in ${comparisonText(facts)}${fixed}.`;
  } else {
    first = `The pass rate ${where} is ${rate}${fixed}.`;
  }
  const rest: string[] = [];
  if (facts.open > 0) {
    rest.push(`${facts.open} ${plural(facts.open, 'failure cause is', 'failure causes are')} still open.`);
  }
  if (facts.wastedMinutes >= 1) {
    const cost = facts.wastedCost
      ? ` (${f.value(facts.wastedCost.amount, 'money', 2, facts.wastedCost.currency)})`
      : '';
    rest.push(`Failed attempts and waits cost ${f.minutes(facts.wastedMinutes)} of CI time${cost}.`);
  }
  return [first, ...rest].join(' ');
}

function progress(p: AnalyticsProgress): string[] {
  const lines: string[] = [];
  if (p.fixed > 0) {
    const held = p.held === p.fixed ? (p.fixed === 1 ? 'it held' : 'all held') : `${p.held} held`;
    lines.push(`${p.fixed} ${plural(p.fixed, 'failure cause', 'failure causes')} fixed; ${held}.`);
  } else {
    lines.push('No failure cause was fixed in the period.');
  }
  if (p.assigned > 0 || p.withTicket > 0) {
    lines.push(
      `${p.assigned} open ${plural(p.assigned, 'cause is', 'causes are')} assigned, ${p.withTicket} ${plural(p.withTicket, 'has', 'have')} a ticket.`,
    );
  }
  if (p.releasedFromQuarantine > 0 || p.quarantined > 0) {
    lines.push(
      `${p.releasedFromQuarantine} ${plural(p.releasedFromQuarantine, 'test', 'tests')} released from quarantine, ${p.quarantined} quarantined.`,
    );
  }
  if (p.healPullRequests > 0) {
    lines.push(`${p.healPullRequests} auto-heal pull ${plural(p.healPullRequests, 'request', 'requests')} opened.`);
  }
  return lines;
}

function risks(r: AnalyticsRisks, f: ValueFormatter): string[] {
  const lines: string[] = [];
  for (const m of r.worsening) {
    const change = f.delta({ unit: m.unit, delta: m.delta, deltaPct: m.deltaPct, precision: 1 });
    lines.push(`${m.label} moved the wrong way: ${f.value(m.value, m.unit, 1)} (${change}).`);
  }
  for (const p of r.failingProjects) {
    lines.push(`${p.name} failed its last ${p.streak} runs in a row.`);
  }
  for (const c of r.oldestOpen) {
    const owner = c.assignee ? `, assigned to ${c.assignee}` : ', unassigned';
    lines.push(`"${c.title}" (${c.projectName}) has been open ${f.value(c.ageDays, 'days', 0)}${owner}.`);
  }
  if (r.quarantine.count > 0) {
    const oldest =
      r.quarantine.oldestDays !== null ? `, the oldest for ${f.value(r.quarantine.oldestDays, 'days', 0)}` : '';
    lines.push(`${r.quarantine.count} ${plural(r.quarantine.count, 'test is', 'tests are')} in quarantine${oldest}.`);
  }
  return lines;
}

export const EN_SENTENCES: ReportSentences = {
  labels: {
    qualityReport: 'Quality report',
    period: 'Period',
    comparedWith: 'Compared with',
    noComparison: 'No comparison',
    projects: 'Projects',
    allProjects: 'All projects',
    branchPolicy: 'Branches',
    defaultBranch: 'Each project’s default branch, plus runs with no known branch',
    allBranches: 'All branches',
    branches: 'Branches',
    fullRunsOnly: 'Full runs only',
    allRuns: 'Full and partial runs',
    testFilter: 'Tests',
    definitions: 'Definitions',
    limits: 'Limits',
    generated: 'Generated',
    generatedBy: 'Generated by Piwi',
    openInPiwi: 'Open in Piwi',
    dashboard: 'Dashboard',
    noData: 'Nothing to show for this period.',
    previous: 'Previous',
    metric: 'Metric',
    value: 'Value',
    change: 'Change',
    date: 'Date',
    unavailable: 'This widget is no longer available.',
    daysAreUtc: 'Days are UTC.',
  },
  verdict,
  progress,
  risks,
  metricLabel: (_id, fallback) => fallback,
  metricDefinition: (_id, fallback) => fallback,
  title: (text) => text,
  reportTitle: (scope, period) => `${scope}, ${period}`,
  projectCount: (n) => `${n} ${plural(n, 'project', 'projects')}`,
  testFilterLimit: (start) =>
    start
      ? `The test filter counts stored executions, which start on ${start}.`
      : 'The test filter counts stored executions, which reach back only as far as retention keeps runs.',
  identityLimit: 'Lists of tests and flaky-test counts reach back only as far as retention keeps runs.',
};
