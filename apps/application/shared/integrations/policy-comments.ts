/**
 * The comments Piwi writes back to a ticket as a cluster evolves — fix landed,
 * regressed, still failing, merged. Each is a neutral {@link IssueDocument}
 * built through the message catalog in the binding's language, so no comment
 * path carries an English literal. The triage notes Piwi writes on the cluster
 * itself stay English (the dashboard is English) and are not built here.
 */
import { doc } from './document';
import { t, type IssueLocale } from './messages';
import type { IssueDocument, Inline } from './document';

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

/** "Still failing — +N occurrences in M runs since the last note, latest run #K." */
export function buildStillFailingComment(
  locale: IssueLocale,
  facts: { addedOccurrences: number; runs: number; latestRun: number; clusterUrl: string | null },
): IssueDocument {
  const sentence = t(locale, 'comment.stillFailing', {
    count: facts.addedOccurrences,
    runs: String(facts.runs),
    latest: String(facts.latestRun),
  });
  return doc()
    .paragraph(sentence, ...dashboardLink(locale, facts.clusterUrl))
    .build();
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
