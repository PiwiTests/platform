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
  'link.dashboard': 'Open in Piwi',
  'link.bugReport': 'Bug report in Piwi',

  // Bug reports (a ticket filed from a report sent from Piwi Picker)
  'section.stepsToReproduce': 'Steps to reproduce',
  'section.expectedActual': 'Expected and actual',
  'section.failingTest': 'The failing test',
  'section.reproductions': 'Reproductions',
  'label.expected': 'Expected',
  'label.actual': 'The page showed',
  'label.note': 'Note',
  'fact.page': 'Page',
  'fact.browser': 'Browser',
  'fact.reportedBy': 'Reported by',
  'fact.reportedOn': 'Reported on',
  'evidence.screenshots': {
    one: '{count} screenshot, attached to this ticket',
    other: '{count} screenshots, attached to this ticket',
  },
  'evidence.console': { one: '{count} console error or warning', other: '{count} console errors and warnings' },
  'evidence.requests': { one: '{count} failed request', other: '{count} failed requests' },
  'text.reportLanguage':
    'Reported in {language}. The steps are written again in the language of this ticket; the title, the note and the values typed by the reporter stay as they were written.',
  'text.failingTest':
    'Commit it as {path}. Marked test.fail(), it keeps the suite green while the bug exists; once it passes, the bug looks fixed.',
  'verdict.reproduced': 'Reproduced',
  'verdict.notReproduced': 'Not reproduced',
  'verdict.diverged': 'Could not reach the bug (step {step})',
  'reproduction.replay': 'replayed in a browser',
  'reproduction.desktop': 'run with Playwright',
  'comment.bugLooksFixed':
    'The test of this bug passed in run #{run} while still marked test.fail(): the bug looks fixed. Remove test.fail() with the fix.',

  // Policy comments (written back to the ticket in its language)
  'comment.fixLanded': 'Fix landed in run #{run} (commit {commit}, {verification}) — every affected test passed.',
  'comment.fixLanded.noCommit': 'Fix landed in run #{run} ({verification}) — every affected test passed.',
  'verification.diagnosisVerified': 'diagnosis-verified',
  'verification.stoppedFailing': 'stopped failing',
  'comment.regressed': 'Regressed in run #{run} — the fix did not hold.',
  'comment.stillFailing': {
    one: 'Still failing — +{count} occurrence in {runs} runs since the last note, latest run #{latest}.',
    other: 'Still failing — +{count} occurrences in {runs} runs since the last note, latest run #{latest}.',
  },
  'comment.mergedInto': 'This failure was merged into {key} — tracking continues there.',
  'comment.absorbed': 'Absorbed {key} into this issue — its failures are tracked here now.',
} satisfies Record<string, MessageValue>;

/** Every message key; `fr.ts` must supply exactly these. */
export type MessageKey = keyof typeof en;
