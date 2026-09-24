/**
 * Pull-request feedback — settings, and the pure builders that turn a finished
 * run into the comment body and commit-status text posted back to the SCM.
 *
 * Everything here is dependency-free and side-effect-free so both the server
 * and the unit tests can build the exact bytes that get posted. The pieces that
 * talk to GitHub / GitLab live in `server/utils/scm/`.
 */

/** `app_settings` key holding the resolved `PrFeedbackSettings`. */
export const PR_FEEDBACK_KEY = 'pr_feedback';

/**
 * Marks the comment Piwi owns on a pull request. Kept in an HTML comment so it
 * renders as nothing, and matched on edit so a run updates its previous comment
 * instead of appending a new one to every push.
 */
export const PR_COMMENT_MARKER = '<!-- piwi-dashboard:run-summary -->';

export interface PrFeedbackSettings {
  /** Master switch. Off by default — posting to a PR needs an explicit opt-in. */
  enabled: boolean;
  /** Post (and update) a summary comment on the pull request. */
  comment: boolean;
  /** Post a commit status against the run's commit. */
  status: boolean;
  /**
   * Only post when the run failed. Keeps green runs from adding noise while
   * still flipping the commit status (a status is a state, not a message).
   */
  onlyOnFailure: boolean;
  /** Context label for the commit status, as shown in the PR checks list. */
  statusContext: string;
}

export const DEFAULT_PR_FEEDBACK: PrFeedbackSettings = {
  enabled: false,
  comment: true,
  status: true,
  onlyOnFailure: false,
  statusContext: 'piwi/tests',
};

/** Merge a partial (possibly untrusted) payload onto the defaults. */
export function resolvePrFeedbackSettings(input?: Partial<PrFeedbackSettings> | null): PrFeedbackSettings {
  const context = typeof input?.statusContext === 'string' ? input.statusContext.trim().slice(0, 80) : '';
  return {
    enabled: input?.enabled === true,
    comment: input?.comment !== false,
    status: input?.status !== false,
    onlyOnFailure: input?.onlyOnFailure === true,
    statusContext: context || DEFAULT_PR_FEEDBACK.statusContext,
  };
}

// ── Summary input ────────────────────────────────────────────────────────────

/** One failing test named in the comment. */
export interface PrFailureEntry {
  title: string;
  filePath: string;
  /** The one-line failure headline, plain text; leads the entry when set. */
  headline?: string | null;
  /** The error's message head, already trimmed for display. */
  errorExcerpt: string | null;
  executionId: number;
  /** Set when the failure joined a cluster, so the comment can link the cause. */
  clusterId?: number | null;
  clusterSignature?: string | null;
  /** The tracker issue the failure's cluster is known by, when one exists. */
  issue?: { key: string; url: string } | null;
  /** Ranked replacement suggested for the locator that broke, when there is one. */
  suggestedLocator?: string | null;
  /** An auto-heal PR already open for this locator, so the reader isn't sent to fix it twice. */
  healPrNumber?: number | null;
  healPrUrl?: string | null;
  /** Tags declared on the test, for routing the reader to an owning team. */
  tags?: string[] | null;
  owner?: string | null;
  /**
   * Set when this test is also flaky on the default branch, so the comment can
   * exonerate a failure the change probably did not cause. `flakinessRate` is
   * the test's flaky rate over recent default-branch runs (0–1).
   */
  flakyOnDefaultBranch?: { branch: string; flakinessRate: number } | null;
}

export interface PrSummaryInput {
  runId: number;
  runUrl: string;
  projectName: string;
  status: string;
  totalTests: number;
  passedTests: number;
  failedTests: number;
  flakyTests: number;
  durationMs: number | null;
  /** Failures that did not fail in the baseline — the ones this change caused. */
  newRegressions: PrFailureEntry[];
  /** Failures that were already failing before this change. */
  preExisting: PrFailureEntry[];
  /** Tests that passed only after a retry in this run. */
  flaky: PrFailureEntry[];
  /** Failure clusters first seen in this run. */
  newClusters: Array<{ id: number; signature: string; caseCount: number }>;
  /** Clusters this run stopped failing — the answer to "did my fix work?". */
  fixedClusters?: Array<{
    id: number;
    label: string;
    testCount: number;
    /** `diagnosis-verified` means the change touched the file the diagnosis named. */
    verification: 'stopped-failing' | 'diagnosis-verified';
    timeToResolutionMs: number | null;
  }>;
  /** CI minutes this run spent on waits and failed attempts, when known. */
  wastedMinutes: number | null;
  /** The named selection this run resolved from, when it came from `piwi run`. */
  selection?: { key: string; testCount: number } | null;
  /** Locks held on two shards at once in this run — the guarantee sharding is meant to keep. */
  splitLocks?: string[] | null;
  /** True when no previous green run existed to compare against. */
  hasBaseline: boolean;
  /** Uncovered-changes section, when the run was pull-request-stamped with a diff. */
  changeCoverage?: PrChangeCoverage | null;
}

// ── Change coverage ──────────────────────────────────────────────────────────

/** One changed file in the uncovered-changes section. */
export interface PrChangeCoverageFile {
  filePath: string;
  additions: number;
  deletions: number;
  reachedInRun: boolean;
  reachedCountHistory: number;
  /** A one-line suggestion for the scenario to write, when there is one. */
  draftTitle?: string | null;
}

export interface PrChangeCoverageTicket {
  ticket: string | null;
  files: PrChangeCoverageFile[];
}

/** The pre-shaped uncovered-changes data the comment renders. */
export interface PrChangeCoverage {
  totalFiles: number;
  uncoveredFiles: number;
  reachedFiles: number;
  ticketCount: number;
  windowRuns: number;
  baseBranch: string | null;
  tickets: PrChangeCoverageTicket[];
  /** True when the diff had more changed files than the provider cap returned. */
  filesTruncated?: boolean;
}

/** Max uncovered files listed in the pull-request comment. */
const MAX_UNCOVERED_LISTED = 10;

/**
 * Render the uncovered-changes section: the files this change touched that no
 * test reaches, grouped by ticket, each with a draft suggestion. Returns null
 * when there is nothing worth a section (no diff, or every file is reached).
 */
export function renderChangeCoverage(cc: PrChangeCoverage): string | null {
  if (cc.totalFiles === 0) return null;
  const base = cc.baseBranch ? codeSpan(cc.baseBranch) : 'the default branch';
  const preface = `Observed reach, not instrumented coverage. Numbers from this run and the last ${cc.windowRuns} on ${base}.`;

  if (cc.uncoveredFiles === 0) {
    return `#### 🟣 Uncovered changes · 0 of ${cc.totalFiles} files\n${preface}\n\nAll ${cc.totalFiles} changed ${cc.totalFiles === 1 ? 'file has' : 'files have'} observed reach.`;
  }

  const header = `#### 🟣 Uncovered changes · ${cc.uncoveredFiles} of ${cc.totalFiles} files · ${cc.ticketCount} ${cc.ticketCount === 1 ? 'ticket' : 'tickets'}`;
  const blocks: string[] = [header, preface];

  // One definition of "uncovered" everywhere: no reach in this run and none in
  // the recent window. A file reached only in history is a separate, lower line.
  let listed = 0;
  let historyOnly = 0;
  for (const group of cc.tickets) {
    const lines: string[] = [];
    for (const file of group.files) {
      if (file.reachedInRun) continue;
      if (file.reachedCountHistory > 0) {
        historyOnly++;
        continue;
      }
      if (listed >= MAX_UNCOVERED_LISTED) continue;
      listed++;
      let line = `- ${codeSpan(file.filePath)} · changed (+${file.additions} −${file.deletions}) · 0 tests in ${cc.windowRuns} runs`;
      if (file.draftTitle) line += `\n  → *${escapeInline(file.draftTitle)}* · draft`;
      lines.push(line);
    }
    if (lines.length === 0) continue;
    const label = group.ticket ? `**${escapeCell(group.ticket)}**` : '**No ticket**';
    blocks.push([label, ...lines].join('\n'));
  }

  const hidden = cc.uncoveredFiles - listed;
  if (hidden > 0) blocks.push(`…and ${hidden} more`);
  if (cc.filesTruncated) {
    blocks.push('The diff was capped, so more files changed than are counted here.');
  }
  if (historyOnly > 0) {
    blocks.push(
      `${historyOnly} ${historyOnly === 1 ? 'file' : 'files'} reached only in the last ${cc.windowRuns} runs, not this run.`,
    );
  }
  if (cc.reachedFiles > 0) {
    blocks.push(
      `${cc.reachedFiles} ${cc.reachedFiles === 1 ? 'file' : 'files'} reached. Gate \`maxUncoveredChanges\`: warn.`,
    );
  } else {
    blocks.push('Gate `maxUncoveredChanges`: warn.');
  }
  return blocks.join('\n\n');
}

// ── Rendering ────────────────────────────────────────────────────────────────

const MAX_LISTED = 5;
/** Max characters of an error excerpt quoted in the pull-request comment. */
export const PR_EXCERPT_MAX = 200;

/** Escape the characters that would break out of a markdown table cell. */
function escapeCell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\r?\n/g, ' ').trim();
}

/**
 * Wrap arbitrary text as an inline code span that no backtick run can break out
 * of. A backtick inside the text (a file path or branch name may carry one) would
 * otherwise close the span and inject markdown into the comment; the CommonMark
 * rule is a fence one backtick longer than the longest run inside, padded with a
 * space so a leading/trailing backtick is not eaten.
 */
function codeSpan(text: string): string {
  const clean = escapeCell(text);
  const longest = Math.max(0, ...(clean.match(/`+/g) ?? []).map((run) => run.length));
  const fence = '`'.repeat(longest + 1);
  const pad = longest > 0 ? ' ' : '';
  return `${fence}${pad}${clean}${pad}${fence}`;
}

/** Escape inline markdown so a headline's locator quotes and underscores render literally. */
function escapeInline(text: string): string {
  return escapeCell(text).replace(/([\\`*_[\]<>])/g, '\\$1');
}

function formatDuration(ms: number | null): string {
  if (ms == null) return '—';
  if (ms < 1000) return `${ms}ms`;
  const seconds = ms / 1000;
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${Math.round(seconds % 60)}s`;
}

/** Coarse age for a cluster's lifetime — days, hours, or minutes. */
function formatAge(ms: number): string {
  const minutes = Math.round(ms / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours}h`;
  return `${Math.round(hours / 24)}d`;
}

function statusEmoji(status: string, failedTests: number): string {
  if (failedTests > 0 || status === 'failed' || status === 'timedout') return '❌';
  if (status === 'interrupted' || status === 'cancelled') return '⚠️';
  return '✅';
}

function renderFailureList(entries: PrFailureEntry[], runUrl: string): string {
  const origin = originOf(runUrl);
  const lines = entries.slice(0, MAX_LISTED).map((entry) => {
    const link = origin
      ? `[${escapeCell(entry.title)}](${origin}/test-run-cases/${entry.executionId})`
      : escapeCell(entry.title);
    const parts = [`- ${link} — ${codeSpan(entry.filePath)}`];
    if (entry.owner) parts.push(`_owner: ${escapeCell(entry.owner)}_`);
    if (entry.tags?.length) parts.push(entry.tags.map((tag) => codeSpan(`@${tag}`)).join(' '));
    let line = parts.join(' · ');
    if (entry.headline) line += `\n  **${escapeInline(entry.headline)}**`;
    if (entry.errorExcerpt) line += `\n  \`\`\`\n  ${escapeCell(entry.errorExcerpt)}\n  \`\`\``;
    if (entry.healPrNumber) {
      const pr = entry.healPrUrl ? `[#${entry.healPrNumber}](${entry.healPrUrl})` : `#${entry.healPrNumber}`;
      line += `\n  🩹 Piwi opened ${pr} to heal this locator.`;
    } else if (entry.suggestedLocator) {
      line += `\n  💡 Try ${codeSpan(entry.suggestedLocator)} instead.`;
    }
    if (entry.flakyOnDefaultBranch) {
      const pct = Math.round(entry.flakyOnDefaultBranch.flakinessRate * 100);
      line += `\n  🎲 Also flaky on ${codeSpan(entry.flakyOnDefaultBranch.branch)} (~${pct}% of recent runs) — likely not yours.`;
    }
    if (entry.issue) {
      line += `\n  🎫 Tracked in [${escapeCell(entry.issue.key)}](${entry.issue.url}).`;
    }
    return line;
  });

  const hidden = entries.length - Math.min(entries.length, MAX_LISTED);
  if (hidden > 0) lines.push(`- …and ${hidden} more`);
  return lines.join('\n');
}

/** The dashboard origin, derived from the run URL so links stay self-hosted. */
function originOf(runUrl: string): string | null {
  try {
    return new URL(runUrl).origin;
  } catch {
    return null;
  }
}

/**
 * Build the markdown comment posted on the pull request.
 *
 * The ordering is deliberate: what this change broke comes first, what was
 * already broken second, and everything else after — a reviewer should be able
 * to stop reading after the first section.
 */
export function buildPrComment(input: PrSummaryInput): string {
  const emoji = statusEmoji(input.status, input.failedTests);
  const sections: string[] = [PR_COMMENT_MARKER];

  sections.push(`### ${emoji} Piwi — ${input.projectName}`);

  const counters = [
    `**${input.passedTests}** passed`,
    `**${input.failedTests}** failed`,
    input.flakyTests > 0 ? `**${input.flakyTests}** flaky` : null,
    `${formatDuration(input.durationMs)}`,
  ].filter(Boolean);
  sections.push(`${counters.join(' · ')} — [full run](${input.runUrl})`);

  if (input.selection) {
    const n = input.selection.testCount;
    sections.push(`🎯 Selection **\`${input.selection.key}\`** — ${n} ${n === 1 ? 'test' : 'tests'}`);
  }

  if (input.splitLocks && input.splitLocks.length > 0) {
    const names = input.splitLocks.map((lock) => codeSpan(lock)).join(', ');
    const plural = input.splitLocks.length === 1 ? 'Lock' : 'Locks';
    sections.push(
      `🔓 ${plural} ${names} held on two shards at once — locks serialize only within one \`playwright test\` process, so sharded runs don't coordinate. Shard with \`piwi run --shard\` (lock-aware) to keep each lock in one shard.`,
    );
  }

  if (input.newRegressions.length > 0) {
    sections.push(
      `#### 🔴 New failures (${input.newRegressions.length})\nNot failing in the last green run.\n\n${renderFailureList(input.newRegressions, input.runUrl)}`,
    );
  }

  if (input.preExisting.length > 0) {
    sections.push(
      `#### 🟠 Pre-existing failures (${input.preExisting.length})\nAlready failing before this change.\n\n${renderFailureList(input.preExisting, input.runUrl)}`,
    );
  }

  if (input.flaky.length > 0) {
    sections.push(
      `#### 🟡 Flaky (${input.flaky.length})\nPassed only after a retry.\n\n${renderFailureList(input.flaky, input.runUrl)}`,
    );
  }

  if (input.newClusters.length > 0) {
    const origin = originOf(input.runUrl);
    const list = input.newClusters
      .slice(0, MAX_LISTED)
      .map((cluster) => {
        const label = escapeCell(cluster.signature);
        const link = origin ? `[${label}](${origin}/failure-clusters/${cluster.id})` : label;
        return `- ${link} — ${cluster.caseCount} ${cluster.caseCount === 1 ? 'test' : 'tests'}`;
      })
      .join('\n');
    sections.push(`#### 🧩 New failure clusters (${input.newClusters.length})\n${list}`);
  }

  const fixedClusters = input.fixedClusters ?? [];
  if (fixedClusters.length > 0) {
    const origin = originOf(input.runUrl);
    const list = fixedClusters
      .slice(0, MAX_LISTED)
      .map((cluster) => {
        const label = escapeCell(cluster.label);
        const link = origin ? `[${label}](${origin}/failure-clusters/${cluster.id})` : label;
        const tests = `${cluster.testCount} ${cluster.testCount === 1 ? 'test' : 'tests'}`;
        const age = cluster.timeToResolutionMs != null ? `, open ${formatAge(cluster.timeToResolutionMs)}` : '';
        const verified = cluster.verification === 'diagnosis-verified' ? ' — matches the diagnosed change' : '';
        return `- ${link} — ${tests}${age}${verified}`;
      })
      .join('\n');
    sections.push(`#### 🟢 Fixed by this change (${fixedClusters.length})\n${list}`);
  }

  if (input.changeCoverage) {
    const section = renderChangeCoverage(input.changeCoverage);
    if (section) sections.push(section);
  }

  if (!input.hasBaseline && input.failedTests > 0) {
    sections.push(
      '> No previous green run for this project, so failures could not be split into new and pre-existing.',
    );
  }

  if (input.wastedMinutes != null && input.wastedMinutes >= 1) {
    sections.push(`🕒 ${input.wastedMinutes.toFixed(1)} CI minutes went to waits and failed attempts in this run.`);
  }

  if (input.failedTests === 0 && input.flakyTests === 0) {
    sections.push('No failures. 🎉');
  }

  return sections.join('\n\n');
}

/** State vocabulary shared by GitHub commit statuses and GitLab commit statuses. */
export type CommitStatusState = 'success' | 'failure' | 'error' | 'pending';

export interface CommitStatusInput {
  state: CommitStatusState;
  description: string;
  targetUrl: string;
  context: string;
}

/** Build the commit status for a finished run. Descriptions are capped at the
 *  140 characters GitHub accepts. */
export function buildCommitStatus(input: PrSummaryInput, context: string): CommitStatusInput {
  const failing = input.failedTests > 0;
  const parts = [`${input.passedTests}/${input.totalTests} passed`];
  if (input.newRegressions.length > 0) parts.push(`${input.newRegressions.length} new`);
  if (input.flakyTests > 0) parts.push(`${input.flakyTests} flaky`);

  return {
    state: failing ? 'failure' : 'success',
    description: parts.join(', ').slice(0, 140),
    targetUrl: input.runUrl,
    context,
  };
}

/**
 * Build the informational commit status for change coverage. Warn-only in this
 * release, so the state is always `success` — it reports, it never blocks.
 */
export function buildChangeCoverageStatus(cc: PrChangeCoverage, targetUrl: string, context: string): CommitStatusInput {
  const description =
    cc.uncoveredFiles > 0
      ? `${cc.uncoveredFiles} of ${cc.totalFiles} changed files have no observed reach`
      : `all ${cc.totalFiles} changed files have observed reach`;
  return {
    state: 'success',
    description: description.slice(0, 140),
    targetUrl,
    context,
  };
}
