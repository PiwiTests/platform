const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const EXTENSION_ORIGIN = /^(chrome|moz|safari-web)-extension:\/\//;

/**
 * Whether a browser sent this state-changing request from another site: an unsafe
 * method whose `Sec-Fetch-Site` is `cross-site` or `same-site`. Browser extensions
 * (Piwi Picker) are allowed by their origin. Requests from servers, the reporter and
 * other tools carry no `Sec-Fetch-Site` and are never refused here.
 */
export function isCrossSiteWrite(request: {
  method: string;
  secFetchSite?: string | null;
  origin?: string | null;
}): boolean {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return false;
  if (request.secFetchSite !== 'cross-site' && request.secFetchSite !== 'same-site') return false;
  return !(request.origin && EXTENSION_ORIGIN.test(request.origin));
}
