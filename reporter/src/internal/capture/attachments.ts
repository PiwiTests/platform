/**
 * Names of the `testInfo` attachments the dashboard fixtures produce and the
 * reporter parses. Single source of truth — imported by the producer
 * (`fixtures.ts`), the consumers (`reporter.ts` / `file-handler.ts`), and the
 * dogfooding `application/tests/fixtures.ts`, so producer and consumer can
 * never drift on a name.
 */
export const ATTACHMENT_NAMES = {
  locators: 'piwi-locators',
  ariaSnapshot: 'piwi-aria-snapshot',
  console: 'piwi-console',
  network: 'piwi-network',
  webVitals: 'piwi-web-vitals',
  locatorSuggestion: 'piwi-locator-suggestion',
} as const;

/** Set of every internal attachment name — used to skip them when collecting user attachments. */
export const INTERNAL_ATTACHMENT_NAMES: ReadonlySet<string> = new Set(Object.values(ATTACHMENT_NAMES));

/** Annotation type that surfaces a locator-healing suggestion in the report/trace. */
export const LOCATOR_SUGGESTION_ANNOTATION = ATTACHMENT_NAMES.locatorSuggestion;
