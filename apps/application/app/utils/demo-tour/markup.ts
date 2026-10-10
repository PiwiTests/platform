const HTML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

const BOLD = /\*\*(.+?)\*\*/g;

/** Escapes text for HTML. */
export function escapeTourHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]!);
}

/**
 * Tour copy as the popover's HTML (driver.js writes it with `innerHTML`): the
 * text escaped, and each `**label**` a `<strong>`.
 */
export function tourMarkup(text: string): string {
  return escapeTourHtml(text).replace(BOLD, '<strong>$1</strong>');
}

/** Tour copy for a place that shows no markup, such as an accessible name: the `**` dropped. */
export function plainTourText(text: string): string {
  return text.replace(BOLD, '$1');
}

/** The `**bold**` dashboard labels a piece of tour copy names, in order. */
export function boldLabels(text: string): string[] {
  return [...text.matchAll(BOLD)].map((match) => match[1]!);
}

/** Fills each `{name}` placeholder from `values`; an unknown name stays as written. */
export function fillTourText(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, name: string) => (name in values ? String(values[name]) : whole));
}
