import { mappedPageKey, type PathPrefixes } from '@piwitests/core/page-key';

/** The page open in the tab, as the tests' pages are keyed. */
export interface PageHere {
  /** The page key compared with the locator index's pages; null for a page that is not http(s). */
  key: string | null;
  /** The URL mapping's path prefix when it was removed from the path; null when none applied. */
  prefixRemoved: string | null;
  /** The URL mapping's tests' path prefix when it was put in front of the path; null when none applied. */
  prefixAdded: string | null;
}

/**
 * The page key of `href` to compare with the pages the tests recorded. The URL
 * mapping's path prefix (`/app` for a site serving `/app/checkout` where the
 * tests ran at `/checkout`) is removed first, when the path starts with it as
 * whole segments; then its tests' path prefix (`/app` for tests that ran
 * `/app/checkout` where the site serves `/checkout`) is put in front. Every
 * comparison of the open page with the locator index goes through this one
 * function.
 */
export function pageHere(href: string, mapping: PathPrefixes | null | undefined): PageHere {
  return mappedPageKey(href, mapping);
}
