import {
  UnfurlProvider,
  type UnfurlResult,
  validateUrl,
  UNFURL_TIMEOUT_MS,
  MAX_RESPONSE_BYTES,
  MAX_REDIRECTS,
  isPrivateHost,
} from './UnfurlProvider';

export class GenericUnfurlProvider extends UnfurlProvider {
  readonly provider = 'generic' as const;

  async unfurl(url: string, _key: string | null): Promise<UnfurlResult> {
    if (!validateUrl(url)) {
      return { title: null, statusText: null, statusColor: null };
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), UNFURL_TIMEOUT_MS);

    let currentUrl = url;
    let redirects = 0;

    try {
      while (redirects <= MAX_REDIRECTS) {
        const currentParsed = new URL(currentUrl);
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

        const titleMatch =
          html.match(/<meta\s+property=["']og:title["']\s+content=["']([^"']+)["']/i) ||
          html.match(/<meta\s+content=["']([^"']+)["']\s+property=["']og:title["']/i) ||
          html.match(/<title>([^<]*)<\/title>/i);
        const title = titleMatch ? (titleMatch[1]?.trim() ?? null) : null;

        return { title, statusText: null, statusColor: null };
      }
    } catch {
      return { title: null, statusText: null, statusColor: null };
    } finally {
      clearTimeout(timer);
    }

    return { title: null, statusText: null, statusColor: null };
  }
}
