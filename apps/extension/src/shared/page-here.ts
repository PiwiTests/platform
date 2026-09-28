import { pageKeyUnderPrefix } from '@piwitests/core/page-key';

/** The page open in the tab, as the tests' pages are keyed. */
export interface PageHere {
  /** The page key compared with the locator index's pages; null for a page that is not http(s). */
  key: string | null;
  /** The URL mapping's path prefix when it was removed from the path; null when none applied. */
  prefixRemoved: string | null;
}

/**
 * The page key of `href` to compare with the pages the tests recorded: the
 * URL mapping's path prefix (`/app` for a site serving `/app/checkout` where
 * the tests ran at `/checkout`) is removed first, when the path starts with
 * it as whole segments. Every comparison of the open page with the locator
 * index goes through this one function.
 */
export function pageHere(href: string, mapping: { pathPrefix?: string | null } | null | undefined): PageHere {
  return pageKeyUnderPrefix(href, mapping?.pathPrefix);
}
