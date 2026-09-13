/**
 * English copy for everything Piwi authors in a ticket — the single source of
 * the English strings, so no English literal is left in the builders. `fr.ts`
 * mirrors these keys exactly (a parity test enforces it); another language is
 * one more file next to these.
 *
 * A value is either a plain string (with `{name}` placeholders) or a set of
 * plural forms selected by `Intl.PluralRules` on the `count` param.
 */

/** A message value: a string, or plural forms keyed by CLDR category. */
export type PluralForms = {
  zero?: string;
  one: string;
  two?: string;
  few?: string;
  many?: string;
  other: string;
};
export type MessageValue = string | PluralForms;

export const en = {
  // Section headings
  'section.whatHappened': 'What happened',
  'section.mostLikely': 'Most likely',
  'section.evidence': 'Evidence',
  'section.whatToDo': 'What to do',
  'section.links': 'Links',
  'section.affectedTests': { one: '{count} affected test', other: '{count} affected tests' },

  // Fact labels
  'fact.errorType': 'Error type',
  'fact.firstSeen': 'First seen',
  'fact.lastSeen': 'Last seen',
  'fact.occurrences': 'Occurrences',
  'fact.branch': 'Branch',
  'fact.environment': 'Environment',
  'fact.commit': 'Commit',

  // Affected-tests table headers
  'table.test': 'Test',
  'table.file': 'File',
  'table.owner': 'Owner',

  // Inline labels
  'label.rootCause': 'Root cause',
  'label.failingLocator': 'Failing locator',
  'label.verify': 'Verify',
  'label.reproduce': 'Reproduce',

  // Link labels
  'link.cluster': 'Failure cluster',
  'link.execution': 'Latest execution',
  'link.run': 'Run',
  'link.share': 'Shareable report',
} satisfies Record<string, MessageValue>;

/** Every message key; `fr.ts` must supply exactly these. */
export type MessageKey = keyof typeof en;
