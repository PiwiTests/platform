import type { AnalyticsNote } from '../../analytics/types';
import { textOptionsSchema } from '../../analytics/registry';
import { markdownToHtml } from '../../markdown-to-html';

/** A note in Markdown, rendered with raw HTML escaped, so a shared dashboard cannot carry a script. */
export async function getAnalyticsNote(
  _db: unknown,
  _scope: unknown,
  _access: unknown,
  rawOptions: unknown = {},
): Promise<AnalyticsNote> {
  const { markdown } = textOptionsSchema.parse(rawOptions ?? {});
  return { markdown, html: markdown.trim() ? markdownToHtml(markdown) : '' };
}
