import { getDatabase } from '../../database';
import { collectClusterBundle, collectExecutionBundle } from '#shared/export/collect';
import { buildExport } from '#shared/export/build';
import { checkRateLimit, rateLimitClientIp, rateLimitedError } from '../../utils/rate-limit';
import { resolveExportBudget, resolveExportMaxCases, serverAssetReader } from '../../utils/export-assets';
import { exportPiwiVersion, exportSourceUrl } from '../../utils/export-request';
import { recordShareLinkView, resolveShareToken, shareLinksEnabled } from '../../utils/share-links';

/** Requests per client address per window — log-noise defense; the 256-bit token is the security boundary. */
const LOOKUP_LIMIT = 120;
const LOOKUP_WINDOW_MS = 15 * 60 * 1000;

/**
 * The public face of a share link: renders the linked execution or failure
 * cluster as the offline export's self-contained HTML, resolved live at view
 * time. Evidence is inlined under the export size budget, so this one route is
 * the whole anonymous surface — no session, no cookies, no follow-up requests.
 */
export default eventHandler(async (event) => {
  // Every branch is uncacheable and uninteresting to crawlers, valid or not.
  setResponseHeader(event, 'Cache-Control', 'no-store');
  setResponseHeader(event, 'X-Robots-Tag', 'noindex, nofollow');

  if (!shareLinksEnabled()) {
    throw apiError({ statusCode: 404, message: 'Not found' });
  }

  const rateKey = `share:${rateLimitClientIp(event)}`;
  if (!checkRateLimit(rateKey, LOOKUP_LIMIT, LOOKUP_WINDOW_MS)) {
    throw rateLimitedError(event, [rateKey]);
  }

  const token = String(getRouterParam(event, 'token') ?? '');
  const db = await getDatabase();
  const resolved = await resolveShareToken(db, token);

  if (resolved.state === 'missing') {
    throw apiError({ statusCode: 404, message: 'Not found' });
  }
  if (resolved.state === 'gone') {
    // The hash matched, so the holder once had the real link — telling them it
    // is dead has no enumeration value and beats a bare 404.
    setResponseStatus(event, 404);
    setResponseHeader(event, 'Content-Type', 'text/html; charset=utf-8');
    setResponseHeader(event, 'Content-Security-Policy', 'sandbox');
    return '<!doctype html><html><head><title>Link no longer available</title></head><body style="font-family: system-ui, sans-serif; margin: 4rem auto; max-width: 32rem; text-align: center;"><h1>This link is no longer available</h1><p>The share link was revoked or has expired. Ask the person who sent it for a new one.</p></body></html>';
  }

  const { link } = resolved;
  const bundle =
    link.entityKind === 'cluster'
      ? await collectClusterBundle(db, link.entityId, {
          maxCases: resolveExportMaxCases(),
          sourceUrl: exportSourceUrl(event, `/failure-clusters/${link.entityId}`),
          piwiVersion: exportPiwiVersion(event),
        })
      : await collectExecutionBundle(db, link.entityId, {
          maxCases: 1,
          sourceUrl: exportSourceUrl(event, `/test-run-cases/${link.entityId}`),
          piwiVersion: exportPiwiVersion(event),
        });

  // The entity was pruned (retention) or deleted — indistinguishable from an
  // unknown token by design.
  if (!bundle) {
    throw apiError({ statusCode: 404, message: 'Not found' });
  }

  const built = await buildExport(bundle, 'html', link.entityId, {
    reader: serverAssetReader,
    budget: resolveExportBudget(),
  });

  await recordShareLinkView(db, link.id);

  setResponseHeader(event, 'Content-Type', built.contentType);
  setResponseHeader(event, 'Content-Length', built.bytes.length);
  setResponseHeader(event, 'Content-Disposition', 'inline');
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
  setResponseHeader(event, 'Referrer-Policy', 'no-referrer');
  // Unique opaque origin: the document cannot read cookies or make
  // credentialed calls back into the dashboard, exactly like a print export.
  setResponseHeader(event, 'Content-Security-Policy', 'sandbox allow-scripts allow-modals');

  return Buffer.from(built.bytes);
});
