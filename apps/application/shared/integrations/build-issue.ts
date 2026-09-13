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
import { DEFAULT_LOCALE, formatNumber, t, type IssueLocale } from './messages';

/** The include toggles the modal and the per-project policy set. */
export interface IssueBuildOpts {
  includeDiagnosis?: boolean;
  includePatch?: boolean;
  includeScreenshot?: boolean;
  includeShareLink?: boolean;
  siteUrl?: string | null;
  /** The language the ticket is written in — a property of its destination. */
  locale?: IssueLocale;
}

export const DEFAULT_ISSUE_OPTS: Required<Omit<IssueBuildOpts, 'siteUrl' | 'locale'>> = {
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
  const locale = opts.locale ?? DEFAULT_LOCALE;
  const b = doc();

  // What happened. The headline is a deterministic English sentence quoting
  // locators and Playwright terms — data, reproduced verbatim.
  b.heading(2, t(locale, 'section.whatHappened'));
  if (facts.headline) b.paragraph(facts.headline);
  const factRows: [string, Inline[]][] = [
    [t(locale, 'fact.errorType'), facts.errorType ? [facts.errorType] : []],
    [t(locale, 'fact.firstSeen'), facts.firstSeen ? [facts.firstSeen] : []],
    [t(locale, 'fact.lastSeen'), facts.lastSeen ? [facts.lastSeen] : []],
    [t(locale, 'fact.occurrences'), [formatNumber(locale, facts.occurrences)]],
    [t(locale, 'fact.branch'), facts.branch ? [code(facts.branch)] : []],
    [t(locale, 'fact.environment'), facts.environment ? [facts.environment] : []],
    [t(locale, 'fact.commit'), facts.commit ? [code(facts.commit)] : []],
  ];
  b.facts(factRows);
  if (facts.affectedTests.length) {
    b.heading(3, t(locale, 'section.affectedTests', { count: facts.affectedTests.length }));
    b.table(
      [t(locale, 'table.test'), t(locale, 'table.file'), t(locale, 'table.owner')],
      facts.affectedTests.map((test) => [test.title, test.filePath ?? '', test.owner ?? '']),
    );
  }

  // Most likely. The diagnosis/root cause are model prose used as stored (their
  // language is the AI response-language setting); the clue is deterministic.
  const mostLikely: DocNode[] = [];
  if (o.includeDiagnosis && (facts.diagnosisSummary || facts.rootCause)) {
    if (facts.diagnosisSummary) mostLikely.push({ type: 'paragraph', inlines: [facts.diagnosisSummary] });
    if (facts.rootCause)
      mostLikely.push({
        type: 'paragraph',
        inlines: [{ text: `${t(locale, 'label.rootCause')}: `, strong: true }, facts.rootCause],
      });
  } else if (facts.clue) {
    mostLikely.push({ type: 'paragraph', inlines: [facts.clue] });
  }
  if (mostLikely.length) {
    b.heading(2, t(locale, 'section.mostLikely'));
    for (const n of mostLikely) b.push(n);
  }

  // Evidence — the error excerpt and the failing locator, quoted verbatim.
  const hasEvidence = facts.errorExcerpt || facts.failingLocator;
  if (hasEvidence) {
    b.heading(2, t(locale, 'section.evidence'));
    if (facts.errorExcerpt) b.code(facts.errorExcerpt);
    if (facts.failingLocator)
      b.paragraph({ text: `${t(locale, 'label.failingLocator')}: `, strong: true }, code(facts.failingLocator));
  }

  // What to do — the patch, locator edit, verify command and reproduce recipe
  // are the team's own code and commands, quoted verbatim.
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
      { type: 'paragraph', inlines: [{ text: `${t(locale, 'label.verify')}:`, strong: true }] },
      { type: 'code', text: facts.verifyCommand },
    );
  if (facts.reproduceScript)
    whatToDo.push(
      { type: 'paragraph', inlines: [{ text: `${t(locale, 'label.reproduce')}:`, strong: true }] },
      { type: 'code', language: 'bash', text: facts.reproduceScript },
    );
  if (whatToDo.length) {
    b.heading(2, t(locale, 'section.whatToDo'));
    for (const n of whatToDo) b.push(n);
  }

  // Links
  const linkItems: Inline[][] = [];
  if (facts.clusterUrl) linkItems.push([{ text: t(locale, 'link.cluster'), href: facts.clusterUrl }]);
  if (facts.executionUrl) linkItems.push([{ text: t(locale, 'link.execution'), href: facts.executionUrl }]);
  if (facts.runUrl) linkItems.push([{ text: t(locale, 'link.run'), href: facts.runUrl }]);
  if (o.includeShareLink && facts.shareUrl) linkItems.push([{ text: t(locale, 'link.share'), href: facts.shareUrl }]);
  if (linkItems.length) {
    b.heading(2, t(locale, 'section.links'));
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
