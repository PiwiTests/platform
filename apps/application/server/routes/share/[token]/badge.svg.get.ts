import { reportBadge, renderBadgeSvg } from '#shared/reports/badge';
import { openShareLink, shareLinkReport } from '../../../utils/share-view';

/**
 * The status badge of a report or a live dashboard link ("tests on default
 * branch · 97.8% · 7 d"), for a README or a wiki page. Every string in it is
 * escaped, and the SVG is served under a CSP that runs nothing.
 */
export default eventHandler(async (event) => {
  const opened = await openShareLink(event, { gonePage: false });
  if ('gone' in opened) return opened.gone;
  const report = await shareLinkReport(opened.db, opened.link);
  if (!report) throw apiError({ statusCode: 404, message: 'Not found' });
  const svg = renderBadgeSvg(reportBadge(report.bundle));
  setResponseHeader(event, 'Content-Type', 'image/svg+xml; charset=utf-8');
  setResponseHeader(event, 'X-Content-Type-Options', 'nosniff');
  setResponseHeader(event, 'Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  return svg;
});
