/**
 * The select value for "every page". A select item cannot have an empty value,
 * and a page key always starts with `/` or an origin, never with a colon.
 */
export const ALL_PAGES = ':all';

/** A few page keys in a sentence: `/checkout, /cart and 3 more`. */
export function formatPageList(pages: readonly string[], shown = 2): string {
  const head = pages.slice(0, shown).join(', ');
  return pages.length > shown ? `${head} and ${pages.length - shown} more` : head;
}
