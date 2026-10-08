import type { H3Event } from 'h3';
import { resolvePublicBaseUrl } from './oauth-helpers';

/**
 * The public base URL of this instance, without a trailing slash:
 * `PIWI_SITE_URL` when set (stable behind a reverse proxy), else the origin of
 * the request.
 */
export function publicBaseUrl(event: H3Event): string {
  const siteUrl = (useRuntimeConfig(event).public as { siteUrl?: string })?.siteUrl;
  const url = getRequestURL(event);
  return resolvePublicBaseUrl(siteUrl, `${url.protocol}//${url.host}`);
}
