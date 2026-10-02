/**
 * The site of a web page as the extension asks for access to it: the origin of
 * an http or https address, and the host permission pattern covering it.
 */

/** The origin of an http or https address; null for any other page (`chrome://`, `about:`, a file) or none. */
export function webOrigin(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:' ? parsed.origin : null;
  } catch {
    return null;
  }
}

/** The host permission pattern for the site of an http or https address, `https://shop.example/*`; null for any other. */
export function originPattern(url: string | null | undefined): string | null {
  const origin = webOrigin(url);
  return origin ? `${origin}/*` : null;
}

/** The origin a host permission pattern covers: `https://shop.example` for `https://shop.example/*`. */
export function patternOrigin(pattern: string): string {
  return pattern.replace(/\/\*$/, '');
}
