import { getDatabase } from '../../database';
import { MCP_OAUTH_RATE_LIMITS } from '../../utils/mcp-oauth-helpers';
import { publicBaseUrl, requireMcpOAuthEnabled, startAuthorization } from '../../utils/mcp-oauth';
import { checkRateLimit, rateLimitClientIp, rateLimitedError } from '../../utils/rate-limit';

defineRouteMeta({
  openAPI: {
    tags: ['MCP OAuth'],
    summary: 'Start an MCP client authorization',
    description:
      'The authorization endpoint of the authorization code flow (RFC 6749 §4.1), opened by the MCP client in the browser. Query: `response_type=code`, `client_id`, `redirect_uri`, `code_challenge` with `code_challenge_method=S256` (required), `state`, and optionally `scope` and `resource` (RFC 8707, the `/mcp` URL). Redirects to the consent page, where the signed-in user allows or denies; an invalid request goes back to the client’s redirect URI with an `error`, or, when the client or its redirect URI is unknown, to the consent page with the error. 404 when authentication is off.',
    security: [],
  },
});

export default eventHandler(async (event) => {
  requireMcpOAuthEnabled(event);
  const rateKey = `mcp-oauth:authorize:${rateLimitClientIp(event)}`;
  const { limit, windowMs } = MCP_OAUTH_RATE_LIMITS.authorize;
  if (!checkRateLimit(rateKey, limit, windowMs)) throw rateLimitedError(event, [rateKey]);

  const start = await startAuthorization(await getDatabase(), getQuery(event), publicBaseUrl(event));
  if (start.kind === 'redirect') return sendRedirect(event, start.url, 302);
  const consent = start.kind === 'consent' ? `request=${start.requestId}` : `error=${start.error}`;
  return sendRedirect(event, `/oauth/consent?${consent}`, 302);
});
