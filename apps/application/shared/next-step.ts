/**
 * One next step, chosen by a policy rather than offered as a menu. Both the
 * execution page and the cluster page assemble the same facts — the verdict,
 * whether locator healing has a recommendation, the cluster's diagnosis and its
 * patch validation, the fix verification, the attempt facts, whether AI and a
 * CI re-run are configured, and the case that blocked this one — and hand them
 * here. The first matching row wins; the caller renders the one primary action
 * and folds the rest into the toolbox.
 *
 * Pure: no DB, no model call. The facts are gathered in the handlers.
 */
import type { FailureWhy } from '#shared/failure-verdict';
import type { ParsedErrorKind } from '#shared/error-parse';

export type NextStepKind =
  | 'open-blocker'
  | 'mark-resolved'
  | 'replace-locator'
  | 'apply-patch'
  | 'follow-diagnosis'
  | 'see-what-changed'
  | 'compare-attempts'
  | 'rerun-in-ci'
  | 'diagnose'
  | 'reproduce';

export interface NextStepAction {
  label: string;
  action: string;
  payload?: Record<string, unknown>;
}

export interface NextStep {
  kind: NextStepKind;
  title: string;
  /** One line saying why this is the step. */
  why: string;
  primary: NextStepAction;
  secondary: NextStepAction[];
}

export interface NextStepInput {
  /** The execution or cluster's own status (`didnotrun` gates the blocker row). */
  status?: string | null;
  /** The failing execution that blocked this one, when this test did not run. */
  blockedByCase?: { id: number; title?: string | null } | null;

  /** The cluster's triage status and fix verification. */
  clusterStatus?: string | null;
  fixVerification?: string | null;
  fixLandedRunId?: number | null;
  fixCommit?: string | null;

  /** Locator healing has a usable recommendation for a locator-resolution failure. */
  hasHealingRecommendation?: boolean;

  /** A completed AI diagnosis exists, its one-line summary and the file it touches. */
  diagnosisCompleted?: boolean;
  diagnosisSummary?: string | null;
  patchFile?: string | null;
  /** The suggested patch is present and validates as applying cleanly to the tree. */
  patchAppliesCleanly?: boolean;

  /** Verdict facts. */
  why?: FailureWhy | null;
  errorKind?: ParsedErrorKind | null;

  /** A provider is configured, and a CI re-run target is configured for this project. */
  aiConfigured?: boolean;
  ciRerunAvailable?: boolean;

  /** Ids the actions carry as payload. */
  clusterId?: number | null;
  executionId?: number | null;
}

export function computeNextStep(input: NextStepInput): NextStep {
  const clusterId = input.clusterId ?? null;
  const withCluster = clusterId != null ? { clusterId } : undefined;
  const withExecution = input.executionId != null ? { executionId: input.executionId } : undefined;

  const verified = input.fixVerification === 'diagnosis-verified' || input.fixVerification === 'stopped-failing';
  const hasCleanPatch = input.diagnosisCompleted === true && input.patchAppliesCleanly === true;

  // 1 — a did-not-run cascade: open the failure that blocked this test.
  if (input.status === 'didnotrun' && input.blockedByCase) {
    return {
      kind: 'open-blocker',
      title: 'Open the failure that blocked this test',
      why: 'This test did not run because an earlier failure stopped it.',
      primary: {
        label: 'Open the blocking failure',
        action: 'open-execution',
        payload: { executionId: input.blockedByCase.id },
      },
      secondary: [],
    };
  }

  // 2 — the fix held: mark the cluster resolved. A fix that truly landed leaves
  // its patch stale against the tree, so a still-clean patch (row 4) wins over
  // marking resolved.
  if (verified && input.clusterStatus === 'open' && !hasCleanPatch) {
    const run = input.fixLandedRunId != null ? ` in run #${input.fixLandedRunId}` : '';
    return {
      kind: 'mark-resolved',
      title: `Mark the cluster resolved — the fix held${run}`,
      why: 'The failures stopped and the fix was verified, but the cluster is still marked open.',
      primary: { label: 'Mark resolved', action: 'mark-resolved', payload: withCluster },
      secondary: [{ label: 'Reopen if it comes back', action: 'reopen', payload: withCluster }],
    };
  }

  // 3 — a locator-resolution failure that healing can repair.
  if (input.hasHealingRecommendation) {
    return {
      kind: 'replace-locator',
      title: 'Replace the locator',
      why: 'The locator no longer resolves; healing found the element under a new locator.',
      primary: { label: 'Copy patch', action: 'copy-patch', payload: withExecution },
      secondary: [
        { label: 'Copy locator', action: 'copy-locator', payload: withExecution },
        { label: 'Pick from snapshot', action: 'pick-from-snapshot', payload: withExecution },
        { label: 'All alternatives', action: 'all-alternatives', payload: withExecution },
      ],
    };
  }

  // 4 — a completed diagnosis whose patch applies cleanly.
  if (hasCleanPatch) {
    const file = input.patchFile?.trim();
    return {
      kind: 'apply-patch',
      title: `Apply the diagnosed fix${file ? ` to ${file}` : ''}`,
      why: 'The diagnosis suggests a patch that applies cleanly to the current code.',
      primary: { label: 'Copy git apply', action: 'copy-git-apply', payload: withCluster },
      secondary: [
        { label: 'Download .patch', action: 'download-patch', payload: withCluster },
        { label: 'Open in IDE', action: 'open-in-ide', payload: withCluster },
        { label: 'Read the diagnosis', action: 'read-diagnosis', payload: withCluster },
      ],
    };
  }

  // 5 — a completed diagnosis whose patch is stale or absent.
  if (input.diagnosisCompleted) {
    return {
      kind: 'follow-diagnosis',
      title: 'Follow the diagnosis',
      why: 'A diagnosis explains the failure, but its patch no longer applies cleanly.',
      primary: { label: 'Read the diagnosis', action: 'read-diagnosis', payload: withCluster },
      secondary: [{ label: 'Re-diagnose', action: 're-diagnose', payload: withCluster }],
    };
  }

  // 6 — a fix regressed: see what changed since it landed.
  if (input.fixVerification === 'regressed') {
    const commit = input.fixCommit?.trim();
    return {
      kind: 'see-what-changed',
      title: `See what changed since the fix${commit ? ` in ${commit}` : ''} — it did not hold`,
      why: 'A recorded fix regressed; the failure is back.',
      primary: { label: 'What changed', action: 'what-changed', payload: withCluster },
      secondary:
        input.clusterStatus === 'resolved' ? [{ label: 'Reopen', action: 'reopen', payload: withCluster }] : [],
    };
  }

  // 7 — a flaky or retry-passing failure: compare the attempts.
  if (input.why === 'passed-on-retry' || input.why === 'new-flaky') {
    return {
      kind: 'compare-attempts',
      title: 'Compare the failing attempt with the passing one',
      why: 'The test failed then passed, so the difference is between attempts, not in the test.',
      primary: { label: 'Attempts', action: 'attempts-tab', payload: withExecution },
      secondary: [{ label: 'Quarantine this test', action: 'quarantine', payload: withExecution }],
    };
  }

  // 8 — an environment-looking crash or navigation, with a CI re-run configured.
  if ((input.errorKind === 'crash' || input.errorKind === 'navigation') && input.ciRerunAvailable) {
    return {
      kind: 'rerun-in-ci',
      title: 'Re-run in CI — this looks like the environment, not the test',
      why: 'A crash or navigation failure often comes from the environment; a clean re-run tells them apart.',
      primary: { label: 'Re-run in CI', action: 'rerun-in-ci', payload: withCluster ?? withExecution },
      secondary: [{ label: 'Reproduce locally', action: 'reproduce', payload: withExecution }],
    };
  }

  // 9 — AI is configured but nothing deterministic explains this yet.
  if (input.aiConfigured && !input.diagnosisCompleted) {
    return {
      kind: 'diagnose',
      title: 'Diagnose with AI — nothing deterministic explains this yet',
      why: 'No clue or healing result is conclusive; an AI diagnosis is the next lead.',
      primary: { label: 'Diagnose with AI', action: 'diagnose', payload: withCluster ?? withExecution },
      secondary: [{ label: 'Reproduce locally', action: 'reproduce', payload: withExecution }],
    };
  }

  // 10 — reproduce locally.
  return {
    kind: 'reproduce',
    title: 'Reproduce locally',
    why: 'Nothing conclusive is known yet; reproduce it to gather more.',
    primary: { label: 'Copy recipe', action: 'copy-recipe', payload: withExecution },
    secondary: [
      { label: 'Copy AI prompt', action: 'copy-ai-prompt', payload: withExecution },
      { label: 'Configure AI', action: 'configure-ai' },
    ],
  };
}
