/**
 * How the settings page names this browser to a Piwi instance when it
 * connects: the instance shows "Piwi Picker in Chrome on Windows" on the page
 * where the user allows it, and names the API key it creates after it.
 * Product names only, never a version or anything else from the user agent.
 */
export interface ClientInfo {
  browser: string;
  os: string;
}

export function describeClient(userAgent: string): ClientInfo {
  const browser = /Edg\//.test(userAgent)
    ? 'Edge'
    : /Firefox\//.test(userAgent)
      ? 'Firefox'
      : /OPR\//.test(userAgent)
        ? 'Opera'
        : /Chrome\//.test(userAgent)
          ? 'Chrome'
          : 'a browser';
  const os = /Windows/.test(userAgent)
    ? 'Windows'
    : /CrOS/.test(userAgent)
      ? 'ChromeOS'
      : /Android/.test(userAgent)
        ? 'Android'
        : /Mac OS X|Macintosh/.test(userAgent)
          ? 'macOS'
          : /Linux/.test(userAgent)
            ? 'Linux'
            : '';
  return { browser, os };
}
