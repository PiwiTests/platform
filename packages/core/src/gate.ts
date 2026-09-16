/**
 * CI gate — turn a finished run into a pass/fail verdict against a policy the
 * pipeline declares.
 *
 * The reporter never fails a build on its own: whether a red test should stop a
 * merge is a policy decision, and policy belongs in the pipeline that owns it.
 * This is the shared, pure half — the facts are gathered server-side and the
 * same evaluation runs for the API, the CLI and the tests.
 */

export interface GatePolicy {
  /**
   * Every test carrying each of these tags must pass. A tag nothing carries is
   * a violation in itself — a policy that silently matches no tests is worse
   * than one that fails loudly, because it looks like it is protecting you.
   */
  requireTags?: string[];
  /** Maximum failing tests tolerated. */
  maxFailed?: number;
  /** Maximum failures that were not failing in the last green run. */
  maxNewRegressions?: number;
  /** Maximum tests that newly started passing only on retry. */
  maxNewFlaky?: number;
  /** Fail when this run introduced a failure cluster never seen before. */
  failOnNewCluster?: boolean;
  /**
   * Fail when more than this many tests are quarantined. Quarantine is a debt,
   * not a solution — this is the ceiling on how much of it a suite may carry.
   */
  maxQuarantined?: number;
  /** Fail when the run contains any flaky test (passed only after a retry). */
  failOnFlaky?: boolean;
  /**
   * Key of a selection every test of which must have run and passed in this run.
   * The server re-resolves the selection's current definition, so this catches
   * the failure mode tags cannot: a smoke job that silently shrank — a renamed
   * file or over-narrow filter dropping a test the selection still expects.
   */
  requireSelection?: string;
}

/** What the server measured about the run, independent of any policy. */
export interface GateFacts {
  runId: number;
  runUrl: string;
  projectName: string;
  status: string;
  totalTests: number;
  failedTests: number;
  newRegressions: number;
  newFlaky: number;
  newClusters: number;
  /** Failing tests grouped by each required tag, keyed by tag. */
  failingByTag: Record<string, Array<{ title: string; filePath: string; executionId: number }>>;
  /** Required tags that matched no test in this run at all. */
  unmatchedTags: string[];
  /** Failing tests excluded from the verdict because they are quarantined. */
  quarantinedFailures: number;
  /** Tests currently quarantined in this project. */
  quarantinedTotal: number;
  /** Tests that passed only after a retry in this run. */
  flakyTests: number;
  /** Set when `requireSelection` was asked: how the named selection fared in this run. */
  selection?: {
    key: string;
    /** How many tests the selection currently resolves to. */
    matched: number;
    /** Matched tests that did not run in this run at all. */
    notRun: Array<{ title: string; filePath: string }>;
    /** Matched tests that ran but failed (and are not quarantined). */
    failed: Array<{ title: string; filePath: string; executionId: number }>;
  };
}

export interface GateViolation {
  /** Stable identifier, so a pipeline can branch on the kind of failure. */
  rule:
    | 'required-tag'
    | 'unmatched-tag'
    | 'max-failed'
    | 'max-new-regressions'
    | 'max-new-flaky'
    | 'new-cluster'
    | 'max-quarantined'
    | 'flaky'
    | 'selection-empty'
    | 'selection-not-run'
    | 'selection-failed';
  message: string;
  /** Observed value and the limit it exceeded, when the rule is a threshold. */
  actual?: number;
  limit?: number;
}

export interface GateResult {
  passed: boolean;
  violations: GateViolation[];
  facts: GateFacts;
}

/** True when the policy asks for nothing — used to reject an empty invocation. */
export function isEmptyPolicy(policy: GatePolicy): boolean {
  return (
    (policy.requireTags?.length ?? 0) === 0 &&
    policy.maxFailed == null &&
    policy.maxNewRegressions == null &&
    policy.maxNewFlaky == null &&
    policy.maxQuarantined == null &&
    !policy.failOnNewCluster &&
    !policy.failOnFlaky &&
    !policy.requireSelection
  );
}

function overLimit(
  rule: GateViolation['rule'],
  label: string,
  actual: number,
  limit: number | undefined,
): GateViolation | null {
  if (limit == null || actual <= limit) return null;
  return {
    rule,
    message: `${actual} ${label} (limit ${limit})`,
    actual,
    limit,
  };
}

/**
 * Apply a policy to the measured facts. Every rule is evaluated — the caller
 * gets the complete list of what is wrong, not just the first thing to trip.
 */
export function evaluateGatePolicy(facts: GateFacts, policy: GatePolicy): GateResult {
  const violations: GateViolation[] = [];

  for (const tag of policy.requireTags ?? []) {
    const failing = facts.failingByTag[tag] ?? [];
    if (failing.length > 0) {
      const names = failing
        .slice(0, 3)
        .map((entry) => entry.title)
        .join(', ');
      const more = failing.length > 3 ? `, +${failing.length - 3} more` : '';
      violations.push({
        rule: 'required-tag',
        message: `${failing.length} required @${tag} ${failing.length === 1 ? 'test' : 'tests'} failed: ${names}${more}`,
        actual: failing.length,
        limit: 0,
      });
    }
  }

  for (const tag of facts.unmatchedTags) {
    violations.push({
      rule: 'unmatched-tag',
      message: `no test in this run carries @${tag} — the tag is misspelled, or the run did not cover it`,
    });
  }

  const thresholds = [
    overLimit('max-failed', 'failing tests', facts.failedTests, policy.maxFailed),
    overLimit('max-new-regressions', 'new regressions', facts.newRegressions, policy.maxNewRegressions),
    overLimit('max-new-flaky', 'newly flaky tests', facts.newFlaky, policy.maxNewFlaky),
  ];
  for (const violation of thresholds) if (violation) violations.push(violation);

  const quarantineViolation = overLimit(
    'max-quarantined',
    'quarantined tests',
    facts.quarantinedTotal,
    policy.maxQuarantined,
  );
  if (quarantineViolation) violations.push(quarantineViolation);

  if (policy.failOnNewCluster && facts.newClusters > 0) {
    violations.push({
      rule: 'new-cluster',
      message: `${facts.newClusters} new failure ${facts.newClusters === 1 ? 'cluster' : 'clusters'} appeared in this run`,
      actual: facts.newClusters,
      limit: 0,
    });
  }

  if (policy.failOnFlaky && facts.flakyTests > 0) {
    violations.push({
      rule: 'flaky',
      message: `${facts.flakyTests} flaky ${facts.flakyTests === 1 ? 'test' : 'tests'} detected in this run`,
      actual: facts.flakyTests,
      limit: 0,
    });
  }

  if (policy.requireSelection && facts.selection) {
    const { key, matched, notRun, failed } = facts.selection;
    if (matched === 0) {
      violations.push({
        rule: 'selection-empty',
        message: `selection "${key}" matches no tests — the definition is too narrow, or nothing in the project qualifies`,
      });
    }
    if (notRun.length > 0) {
      const names = notRun
        .slice(0, 3)
        .map((entry) => entry.title)
        .join(', ');
      const more = notRun.length > 3 ? `, +${notRun.length - 3} more` : '';
      violations.push({
        rule: 'selection-not-run',
        message: `${notRun.length} test${notRun.length === 1 ? '' : 's'} in selection "${key}" did not run: ${names}${more}`,
        actual: notRun.length,
        limit: 0,
      });
    }
    if (failed.length > 0) {
      const names = failed
        .slice(0, 3)
        .map((entry) => entry.title)
        .join(', ');
      const more = failed.length > 3 ? `, +${failed.length - 3} more` : '';
      violations.push({
        rule: 'selection-failed',
        message: `${failed.length} test${failed.length === 1 ? '' : 's'} in selection "${key}" failed: ${names}${more}`,
        actual: failed.length,
        limit: 0,
      });
    }
  }

  return { passed: violations.length === 0, violations, facts };
}

/** Render a gate result for a CI log. Returns one line per fact or violation. */
export function formatGateResult(result: GateResult): string {
  const { facts } = result;
  const lines = [
    result.passed
      ? `✔ Piwi gate passed — ${facts.projectName} run #${facts.runId}`
      : `✖ Piwi gate failed — ${facts.projectName} run #${facts.runId}`,
    `  ${facts.totalTests} tests, ${facts.failedTests} failed, ${facts.newRegressions} new, ${facts.newFlaky} newly flaky, ${facts.flakyTests} flaky`,
  ];
  if (facts.quarantinedFailures > 0) {
    lines.push(
      `  ${facts.quarantinedFailures} failing ${facts.quarantinedFailures === 1 ? 'test is' : 'tests are'} quarantined and did not count`,
    );
  }
  for (const violation of result.violations) lines.push(`  ✖ ${violation.message}`);
  lines.push(`  ${facts.runUrl}`);
  return lines.join('\n');
}
