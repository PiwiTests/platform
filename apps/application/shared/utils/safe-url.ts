/**
 * `url` when it is an absolute http(s) URL, else null. Use it wherever a URL a
 * user or a reporter supplied (an issue link, a CI build URL) is bound to an
 * `href`, so a `javascript:` or `data:` URL never becomes a live link.
 */
export function safeHttpUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

/** Whether a Markdown link target may render as a link: an http(s) or mailto URL, or a same-site path, fragment or query. */
export function isSafeLinkTarget(href: string): boolean {
  return /^(?:https?:\/\/|mailto:|\/(?!\/)|#|\?)/i.test(href);
}
