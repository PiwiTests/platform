/**
 * Generic unfurl utility — fetches a URL and extracts title/status.
 * Includes SSRF protection: blocks private/loopback/link-local IPs.
 */

const TIMEOUT_MS = 3000;
const MAX_RESPONSE_BYTES = 512_000;
const MAX_REDIRECTS = 5;

// RFC 1918 private ranges, loopback, link-local, metadata IPs, etc.
const PRIVATE_PATTERNS = [
  /^127\./,
  /^10\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^192\.168\./,
  /^169\.254\./,
  /^0\./,
  /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./,
  /^198\.18\./,
  /^::1$/,
  /^fc00:/,
  /^fe80:/,
];

function isPrivateHost(hostname: string): boolean {
  // Strip IPv6 brackets
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase();
  return PRIVATE_PATTERNS.some((p) => p.test(host));
}

interface UnfurlResult {
  title: string | null;
  statusText: string | null;
  statusColor: string | null;
}

export async function unfurlUrl(url: string): Promise<UnfurlResult> {
  // Only http/https allowed
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return { title: null, statusText: null, statusColor: null };
  }

  // SSRF guard: block private IPs before resolving (best-effort for hostnames)
  if (isPrivateHost(parsed.hostname)) {
    return { title: null, statusText: null, statusColor: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let currentUrl = url;
  let redirects = 0;

  try {
    while (redirects <= MAX_REDIRECTS) {
      const currentParsed = new URL(currentUrl);

      // Re-check SSRF for redirect targets too
      if (isPrivateHost(currentParsed.hostname)) {
        return { title: null, statusText: null, statusColor: null };
      }

      const response = await fetch(currentUrl, {
        signal: controller.signal,
        redirect: 'manual',
        headers: {
          'User-Agent': 'Piwi-Dashboard/1.0 (+https://piwi.dashboard)',
          Accept: 'text/html,application/xhtml+xml',
        },
      });

      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get('location');
        if (!location) break;
        currentUrl = new URL(location, currentUrl).href;
        redirects++;
        continue;
      }

      // Read up to MAX_RESPONSE_BYTES
      const reader = response.body?.getReader();
      if (!reader) break;

      const chunks: Uint8Array[] = [];
      let total = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
        if (total > MAX_RESPONSE_BYTES) {
          reader.cancel();
          break;
        }
      }

      const decoder = new TextDecoder();
      const html = chunks.map((c) => decoder.decode(c, { stream: false })).join('');

      // Extract title
      const titleMatch =
        html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
        html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i) ||
        html.match(/<title>([^<]*)<\/title>/i);
      const title = titleMatch ? (titleMatch[1]?.trim() ?? null) : null;

      return { title, statusText: null, statusColor: null };
    }
  } catch {
    // Timeout, network error, etc. — return nothing
    return { title: null, statusText: null, statusColor: null };
  } finally {
    clearTimeout(timer);
  }

  return { title: null, statusText: null, statusColor: null };
}
