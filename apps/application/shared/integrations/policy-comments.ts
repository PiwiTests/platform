/**
 * The comments Piwi writes back to a ticket as a cluster evolves — fix landed,
 * regressed, still failing, diagnosed, merged. Each is a neutral {@link IssueDocument}
 * built through the message catalog in the binding's language, so no comment
 * path carries an English literal. The triage notes Piwi writes on the cluster
 * itself stay English (the dashboard is English) and are not built here.
 */
import { doc } from './document';
import { t, type IssueLocale } from './messages';
import { diagnosisCategoryText, label, wherePhrase } from './build-issue';
import type { IssueDocument, Inline } from './document';

/** Titles a still-failing note lists before it only counts the rest. */
const NEW_TESTS_LISTED = 5;

/** How the fix was corroborated — the two verdicts a comment reports. */
export type FixCommentVerification = 'diagnosis-verified' | 'stopped-failing';

/** A trailing "Open in Piwi" link, appended when a cluster URL is known. */
function dashboardLink(locale: IssueLocale, clusterUrl: string | null): Inline[] {
  if (!clusterUrl) return [];
  return [' ', { text: t(locale, 'link.dashboard'), href: clusterUrl }];
}

function verificationWord(locale: IssueLocale, verification: FixCommentVerification): string {
  return verification === 'diagnosis-verified'
    ? t(locale, 'verification.diagnosisVerified')
    : t(locale, 'verification.stoppedFailing');
}

/** "Fix landed in run #N (commit abc123, diagnosis-verified) — every affected test passed." */
export function buildFixComment(
  locale: IssueLocale,
  facts: { runNumber: number; commit: string | null; verification: FixCommentVerification; clusterUrl: string | null },
): IssueDocument {
  const verification = verificationWord(locale, facts.verification);
  const sentence = facts.commit
    ? t(locale, 'comment.fixLanded', { run: String(facts.runNumber), commit: facts.commit.slice(0, 12), verification })
    : t(locale, 'comment.fixLanded.noCommit', { run: String(facts.runNumber), verification });
  return doc()
    .paragraph(sentence, ...dashboardLink(locale, facts.clusterUrl))
    .build();
}

/** "Regressed in run #N — the fix did not hold." */
export function buildRegressionComment(
  locale: IssueLocale,
  facts: { runNumber: number; clusterUrl: string | null },
): IssueDocument {
  return doc()
    .paragraph(
      t(locale, 'comment.regressed', { run: String(facts.runNumber) }),
      ...dashboardLink(locale, facts.clusterUrl),
    )
    .build();
}

/**
 * "Still failing — +N occurrences in M runs since the last note, latest run #K",
 * where it last failed, and what is new since the last note: branches and
 * environments it reached, tests it now fails in.
 */
export function buildStillFailingComment(
  locale: IssueLocale,
  facts: {
    addedOccurrences: number;
    runs: number;
    latestRun: number;
    latestBranch?: string | null;
    latestEnvironment?: string | null;
    newTests?: string[];
    newBranches?: string[];
    newEnvironments?: string[];
    clusterUrl: string | null;
  },
): IssueDocument {
  const sentence = t(locale, 'comment.stillFailing', {
    count: facts.addedOccurrences,
    runs: t(locale, 'count.runs', { count: facts.runs }),
    latest: String(facts.latestRun),
  });
  const where = facts.latestBranch
    ? t(locale, 'comment.lastFailureOn', {
        where: wherePhrase([facts.latestBranch], facts.latestEnvironment ? [facts.latestEnvironment] : []),
      })
    : facts.latestEnvironment
      ? t(locale, 'comment.lastFailureIn', { where: facts.latestEnvironment })
      : null;
  const b = doc().paragraph(sentence, ...(where ? [' ', where] : []), ...dashboardLink(locale, facts.clusterUrl));

  const newBranches = facts.newBranches ?? [];
  if (newBranches.length)
    b.paragraph(t(locale, 'comment.newBranches', { count: newBranches.length, list: newBranches.join(', ') }));
  const newEnvironments = facts.newEnvironments ?? [];
  if (newEnvironments.length)
    b.paragraph(
      t(locale, 'comment.newEnvironments', { count: newEnvironments.length, list: newEnvironments.join(', ') }),
    );
  const newTests = facts.newTests ?? [];
  if (newTests.length) {
    b.paragraph(t(locale, 'comment.newTests', { count: newTests.length }));
    b.bullets(newTests.slice(0, NEW_TESTS_LISTED).map((title) => [title]));
    if (newTests.length > NEW_TESTS_LISTED)
      b.paragraph(t(locale, 'text.moreTests', { count: newTests.length - NEW_TESTS_LISTED }));
  }
  return b.build();
}

/** The diagnosis of a tracked cluster: its summary, root cause and category, in the model's own words. */
export function buildDiagnosisComment(
  locale: IssueLocale,
  facts: {
    summary: string | null;
    rootCause: string | null;
    category: string | null;
    confidence: string | null;
    clusterUrl: string | null;
  },
): IssueDocument {
  const b = doc().paragraph(
    { text: t(locale, 'comment.diagnosis'), strong: true },
    ...(facts.summary ? [' ', facts.summary] : []),
  );
  if (facts.rootCause) b.paragraph(...label(t(locale, 'label.rootCause')), facts.rootCause);
  const category = diagnosisCategoryText(locale, facts.category, facts.confidence);
  if (category) b.paragraph(...label(t(locale, 'label.category')), category);
  if (facts.clusterUrl) b.paragraph({ text: t(locale, 'link.dashboard'), href: facts.clusterUrl });
  return b.build();
}

/** A merge note on either issue: the survivor absorbs, the victim is merged into it. */
export function buildMergeComment(
  locale: IssueLocale,
  facts: { direction: 'into' | 'absorbed'; otherKey: string; clusterUrl: string | null },
): IssueDocument {
  const key = facts.direction === 'into' ? 'comment.mergedInto' : 'comment.absorbed';
  return doc()
    .paragraph(t(locale, key, { key: facts.otherKey }), ...dashboardLink(locale, facts.clusterUrl))
    .build();
}
