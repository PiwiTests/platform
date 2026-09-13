/**
 * Turn the facts Piwi already holds about a failure into a provider-neutral
 * `IssueDocument`, in the cluster page's reading order: what happened, the most
 * likely cause, the evidence, what to do, the links. Every section degrades
 * independently — a cluster with no diagnosis still yields evidence and a verify
 * command.
 *
 * This half is pure: the server gathers the facts (`server/utils/integrations/
 * documents.ts`) and the demo mirror seeds them, and both render the same body
 * through here, so the two can never drift.
 */
import { doc, type DocNode, type Inline, type IssueDocument } from './document';

/** The include toggles the modal and the per-project policy set. */
export interface IssueBuildOpts {
  includeDiagnosis?: boolean;
  includePatch?: boolean;
  includeScreenshot?: boolean;
  includeShareLink?: boolean;
  siteUrl?: string | null;
}

export const DEFAULT_ISSUE_OPTS: Required<Omit<IssueBuildOpts, 'siteUrl'>> = {
  includeDiagnosis: true,
  includePatch: true,
  includeScreenshot: false,
  includeShareLink: false,
};

/** One affected test row, as the "What happened" table lists it. */
export interface AffectedTestFact {
  title: string;
  filePath: string | null;
  owner: string | null;
}

/** One suggested locator replacement, from the fix plan. */
export interface LocatorEditFact {
  filePath: string;
  line: number | null;
  failingLocator: string | null;
  suggestedLocator: string | null;
}

/** Everything the builder reads; assembled from the DB (or seeded in the demo). */
export interface IssueFacts {
  clusterId: number;
  fingerprint: string;
  /** The ticket title — the AI title, else the deterministic cluster name. */
  title: string;
  /** The latest occurrence's one-line headline, when it adds to the title. */
  headline: string | null;
  errorType: string | null;
  firstSeen: string | null;
  lastSeen: string | null;
  occurrences: number;
  affectedTests: AffectedTestFact[];
  branch: string | null;
  environment: string | null;
  commit: string | null;

  diagnosisSummary: string | null;
  rootCause: string | null;
  /** The top clue, shown when there is no diagnosis. */
  clue: string | null;

  errorExcerpt: string | null;
  failingLocator: string | null;

  /** Unified-diff patch from the fix plan. */
  patch: string | null;
  locatorEdits: LocatorEditFact[];
  verifyCommand: string | null;
  reproduceScript: string | null;

  clusterUrl: string | null;
  executionUrl: string | null;
  runUrl: string | null;
  shareUrl: string | null;
}

/** The finished issue: title, body, and the labels every Piwi issue carries. */
export interface BuiltIssue {
  title: string;
  document: IssueDocument;
  labels: string[];
}

/** `piwi`, `piwi-cluster-<id>`, `piwi-fp-<first 8 hex>` — how dedupe finds it later. */
export function issueLabels(clusterId: number, fingerprint: string): string[] {
  const fp = fingerprint.slice(0, 8);
  return ['piwi', `piwi-cluster-${clusterId}`, `piwi-fp-${fp}`];
}

function code(text: string): Inline {
  return { text, code: true };
}

/** Assemble the document from gathered facts and the include toggles. */
export function buildIssueDocument(facts: IssueFacts, opts: IssueBuildOpts = {}): IssueDocument {
  const o = { ...DEFAULT_ISSUE_OPTS, ...opts };
  const b = doc();

  // What happened
  b.heading(2, 'What happened');
  if (facts.headline) b.paragraph(facts.headline);
  const factRows: [string, Inline[]][] = [
    ['Error type', facts.errorType ? [facts.errorType] : []],
    ['First seen', facts.firstSeen ? [facts.firstSeen] : []],
    ['Last seen', facts.lastSeen ? [facts.lastSeen] : []],
    ['Occurrences', [String(facts.occurrences)]],
    ['Branch', facts.branch ? [code(facts.branch)] : []],
    ['Environment', facts.environment ? [facts.environment] : []],
    ['Commit', facts.commit ? [code(facts.commit)] : []],
  ];
  b.facts(factRows);
  if (facts.affectedTests.length) {
    b.heading(3, 'Affected tests');
    b.table(
      ['Test', 'File', 'Owner'],
      facts.affectedTests.map((t) => [t.title, t.filePath ?? '', t.owner ?? '']),
    );
  }

  // Most likely
  const mostLikely: DocNode[] = [];
  if (o.includeDiagnosis && (facts.diagnosisSummary || facts.rootCause)) {
    if (facts.diagnosisSummary) mostLikely.push({ type: 'paragraph', inlines: [facts.diagnosisSummary] });
    if (facts.rootCause)
      mostLikely.push({ type: 'paragraph', inlines: [{ text: 'Root cause: ', strong: true }, facts.rootCause] });
  } else if (facts.clue) {
    mostLikely.push({ type: 'paragraph', inlines: [facts.clue] });
  }
  if (mostLikely.length) {
    b.heading(2, 'Most likely');
    for (const n of mostLikely) b.push(n);
  }

  // Evidence
  const hasEvidence = facts.errorExcerpt || facts.failingLocator;
  if (hasEvidence) {
    b.heading(2, 'Evidence');
    if (facts.errorExcerpt) b.code(facts.errorExcerpt);
    if (facts.failingLocator) b.paragraph({ text: 'Failing locator: ', strong: true }, code(facts.failingLocator));
  }

  // What to do
  const whatToDo: DocNode[] = [];
  if (o.includePatch && facts.patch) whatToDo.push({ type: 'code', language: 'diff', text: facts.patch });
  const locatorItems: Inline[][] = facts.locatorEdits
    .filter((e) => e.suggestedLocator)
    .map((e) => {
      const where = e.line != null ? `${e.filePath}:${e.line}` : e.filePath;
      const parts: Inline[] = [code(where), ' — '];
      if (e.failingLocator) parts.push(code(e.failingLocator), ' → ');
      parts.push(code(e.suggestedLocator ?? ''));
      return parts;
    });
  if (locatorItems.length) whatToDo.push({ type: 'bullets', items: locatorItems });
  if (facts.verifyCommand)
    whatToDo.push(
      { type: 'paragraph', inlines: [{ text: 'Verify:', strong: true }] },
      { type: 'code', text: facts.verifyCommand },
    );
  if (facts.reproduceScript)
    whatToDo.push(
      { type: 'paragraph', inlines: [{ text: 'Reproduce:', strong: true }] },
      { type: 'code', language: 'bash', text: facts.reproduceScript },
    );
  if (whatToDo.length) {
    b.heading(2, 'What to do');
    for (const n of whatToDo) b.push(n);
  }

  // Links
  const linkItems: Inline[][] = [];
  if (facts.clusterUrl) linkItems.push([{ text: 'Failure cluster', href: facts.clusterUrl }]);
  if (facts.executionUrl) linkItems.push([{ text: 'Latest execution', href: facts.executionUrl }]);
  if (facts.runUrl) linkItems.push([{ text: 'Run', href: facts.runUrl }]);
  if (o.includeShareLink && facts.shareUrl) linkItems.push([{ text: 'Shareable report', href: facts.shareUrl }]);
  if (linkItems.length) {
    b.heading(2, 'Links');
    b.bullets(linkItems);
  }

  // Trailer — a JQL filter or a human can find every Piwi-filed issue by it.
  b.rule();
  b.paragraph(code(`Piwi-Cluster: ${facts.clusterId}`));

  return b.build();
}

/** The full built issue: title, document, and the standard labels. */
export function buildIssue(facts: IssueFacts, opts: IssueBuildOpts = {}): BuiltIssue {
  return {
    title: facts.title,
    document: buildIssueDocument(facts, opts),
    labels: issueLabels(facts.clusterId, facts.fingerprint),
  };
}
