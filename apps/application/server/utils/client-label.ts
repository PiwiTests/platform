/**
 * A name a client supplies about itself (a browser, an editor, an MCP client),
 * cleaned for the pages that show it and the API key named after it: letters,
 * digits, spaces and `. _ ( ) -`, runs of whitespace collapsed, at most
 * `maxLength` characters, and `fallback` when nothing is left.
 */
export function cleanClientLabel(value: unknown, fallback: string, maxLength: number): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value
    .replace(/[^\p{L}\p{N} ._()-]/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, maxLength);
  return cleaned || fallback;
}
